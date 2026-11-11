// Queue worker for the social publisher. pg_cron calls it every 2 minutes
// (see migration 20261111120000); the dashboard also calls it right after a
// "publish now", so the first step starts without waiting.
//
// 1) Due posts (status scheduled, scheduled_at passed) become "publishing"
//    and get one target per network of their brand.
// 2) Each target moves forward one step per run, so no run waits on a
//    network's video processing:
//      Instagram: create a Reels container from a signed video URL -> wait
//                 for FINISHED -> media_publish -> permalink.
//      Facebook:  video_reels start -> upload by file_url -> wait for
//                 processing -> finish (PUBLISHED) -> wait -> permalink.
//      TikTok:    inbox draft (until the app audit) -> status.
//      YouTube / LinkedIn: one step (upload + publish).
//    Every step first claims the target, so overlapping runs never post twice.
// 3) When all targets of a post are done it is marked done / partial /
//    failed, the owner gets one WhatsApp summary, and (if everything was
//    published) the video file is deleted from storage.
// Deploy with: supabase functions deploy social-publish --no-verify-jwt

import {
  CORS, DASH, GRAPH_VERSION, deleteVideo, getSetting, graph, json, patch, rest, sendWhatsApp, signedVideoUrl,
} from '../_shared/social.ts'
import { TIKTOK_DIRECT, listVideos, refreshToken, startUpload, uploadStatus, type TikTokToken, type TikTokVideo } from '../_shared/tiktok.ts'
import { channelFeedStats, uploadYoutube, youtubeAccess } from '../_shared/youtube.ts'
import { postLinkedinVideo } from '../_shared/linkedin.ts'

const BUDGET_MS = 100_000
const STEP_TIMEOUT_MIN = 30
const PLATFORM_HE: Record<string, string> = { instagram: 'אינסטגרם', facebook: 'פייסבוק', tiktok: 'טיקטוק', youtube: 'יוטיוב', linkedin: 'לינקדאין' }
const BRAND_HE: Record<string, string> = { callio: 'Callio', stopzkor: 'StopZkor', al: 'A.L Systems' }
const NOT_CONNECTED: Record<string, string> = {}

const now = () => new Date().toISOString()
const later = (sec: number) => new Date(Date.now() + sec * 1000).toISOString()

type Target = {
  id: number; post_id: number; platform: string; status: string; container_id: string | null; external_id: string | null
  attempts: number; started_at: string | null
  post: {
    id: number; brand: string; video_path: string; caption: string; captions: Record<string, string>; status: string
    options: { ig_trial?: boolean; ig_collab?: string[]; cover_ms?: number } | null
  }
  account: { id: number; platform: string; external_id: string; token: string; token_expires_at: string | null; parent_id: string | null; status: string } | null
}

// ---------- 1) activate due posts ----------
async function activateDuePosts() {
  const due = await rest(`social_posts?status=eq.scheduled&scheduled_at=lte.${encodeURIComponent(now())}&select=id,brand,platforms,platform_times&order=scheduled_at&limit=20`)
  for (const p of due || []) {
    // Atomic: only the run that flips scheduled -> publishing creates targets.
    const got = await rest(`social_posts?id=eq.${p.id}&status=eq.scheduled`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'publishing' }),
    })
    if (!got?.length) continue
    await createTargets(p)
  }
  // Recovery: a post that is publishing but has no targets (e.g. a run that
  // died between the two steps) gets them now. Duplicates are ignored.
  const orphans = await rest(`social_posts?status=eq.publishing&select=id,brand,platforms,platform_times,targets:social_targets(id)&limit=20`)
  for (const p of orphans || []) if (!p.targets?.length) await createTargets(p)
}

async function createTargets(p: { id: number; brand: string; platforms: string[]; platform_times?: Record<string, string> }) {
  const accounts = await rest(`social_accounts?brand=eq.${encodeURIComponent(p.brand)}&status=eq.ok&select=id,platform`)
  const byPlatform = new Map((accounts || []).map((a: any) => [a.platform, a.id]))
  // Every row has the same keys: PostgREST rejects a bulk insert otherwise.
  const rows = p.platforms.map((platform) => {
    const acc = byPlatform.get(platform) ?? null
    return {
      // A network with its own time waits for it (the worker only picks
      // targets whose next_check_at has passed).
      post_id: p.id, platform, account_id: acc, next_check_at: p.platform_times?.[platform] || now(),
      status: acc ? 'pending' : 'failed',
      error: acc ? null : (NOT_CONNECTED[platform] || `אין חשבון ${PLATFORM_HE[platform] || platform} מחובר ל-${BRAND_HE[p.brand] || p.brand}`),
    }
  })
  if (rows.length) {
    await rest('social_targets?on_conflict=post_id,platform', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(rows),
    })
  }
}

// ---------- 2) move targets forward ----------
async function claim(id: number): Promise<boolean> {
  const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const got = await rest(`social_targets?id=eq.${id}&or=(claim.is.null,claimed_at.lt.${encodeURIComponent(stale)})`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ claim: crypto.randomUUID(), claimed_at: now() }),
  })
  return !!got?.length
}
const save = (id: number, body: Record<string, unknown>) =>
  patch('social_targets', `id=eq.${id}`, { ...body, claim: null, claimed_at: null, updated_at: now() })
const fail = (t: Target, error: string) => save(t.id, { status: 'failed', error: error.slice(0, 500) })
const tooLong = (t: Target) => t.started_at && Date.now() - new Date(t.started_at).getTime() > STEP_TIMEOUT_MIN * 60 * 1000

async function stepInstagram(t: Target, caption: string) {
  const ig = t.account!.external_id, token = t.account!.token
  if (t.status === 'pending') {
    const videoUrl = await signedVideoUrl(t.post.video_path)
    const base: Record<string, string> = { media_type: 'REELS', video_url: videoUrl, caption, access_token: token }
    // Options from the dashboard: cover frame, trial reel (shown to
    // non-followers first), collaborators (the reel appears on their profile
    // too once they accept the invite in the app).
    const o = t.post.options || {}
    const extra: Record<string, string> = {}
    if (typeof o.cover_ms === 'number' && o.cover_ms > 0) extra.thumb_offset = String(Math.round(o.cover_ms))
    if (o.ig_trial) extra.trial_params = JSON.stringify({ graduation_strategy: 'SS_PERFORMANCE' })
    else {
      base.share_to_feed = 'true'
      const collab = (o.ig_collab || []).map((u) => u.replace(/^@/, '').trim()).filter(Boolean).slice(0, 3)
      if (collab.length) extra.collaborators = JSON.stringify(collab)
    }
    let c, note: string | null = null
    try {
      c = await graph(`${ig}/media`, { ...base, ...extra }, 'POST')
    } catch (e) {
      // An option Instagram refused must not block the post itself.
      if ((e as { transient?: boolean }).transient || !Object.keys(extra).length) throw e
      console.log('instagram: options refused, posting without them:', (e as Error).message)
      if (o.ig_trial) base.share_to_feed = 'true'
      c = await graph(`${ig}/media`, base, 'POST')
      note = 'עלה בלי האפשרויות הנוספות (Trial / שיתוף / שער): ' + (e as Error).message
    }
    return save(t.id, { status: 'processing', container_id: c.id, started_at: now(), next_check_at: later(40), error: note })
  }
  const s = await graph(t.container_id!, { fields: 'status_code,status', access_token: token })
  if (s.status_code === 'FINISHED') {
    const pub = await graph(`${ig}/media_publish`, { creation_id: t.container_id!, access_token: token }, 'POST')
    let permalink: string | null = null
    try { permalink = (await graph(pub.id, { fields: 'permalink', access_token: token })).permalink || null } catch { /* link is a nice-to-have */ }
    return save(t.id, { status: 'published', external_id: pub.id, permalink, published_at: now() })
  }
  if (s.status_code === 'PUBLISHED') return save(t.id, { status: 'published', published_at: now(), error: null })
  if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') return fail(t, 'אינסטגרם דחה את הסרטון: ' + (s.status || s.status_code))
  if (tooLong(t)) return fail(t, 'אינסטגרם לא סיים לעבד את הסרטון תוך 30 דקות')
  return save(t.id, { next_check_at: later(40) })
}

async function stepFacebook(t: Target, caption: string) {
  const page = t.account!.external_id, token = t.account!.token
  if (t.status === 'pending') {
    const start = await graph(`${page}/video_reels`, { upload_phase: 'start', access_token: token }, 'POST')
    const videoUrl = await signedVideoUrl(t.post.video_path)
    const up = await fetch(`https://rupload.facebook.com/video-upload/${GRAPH_VERSION}/${start.video_id}`, {
      method: 'POST', headers: { Authorization: `OAuth ${token}`, file_url: videoUrl },
    })
    const ud = await up.json().catch(() => ({}))
    if (!up.ok || !ud.success) throw new Error('העלאה לפייסבוק נכשלה: ' + (ud.debug_info?.message || ud.error?.message || up.status))
    return save(t.id, { status: 'processing', container_id: start.video_id, started_at: now(), next_check_at: later(30), error: null })
  }
  // Classic page video ("v:<id>"): used when Facebook won't take it as a Reel
  // (Reels are 3-90 seconds). Published as soon as Facebook has processed it.
  if (t.container_id?.startsWith('v:')) {
    const id = t.container_id.slice(2)
    const v = await graph(id, { fields: 'status,permalink_url', access_token: token })
    const st = String(v.status?.video_status || '')
    if (st === 'ready') {
      const p = v.permalink_url
      return save(t.id, { status: 'published', permalink: p ? (p.startsWith('http') ? p : `https://www.facebook.com${p}`) : null, published_at: now(), error: null })
    }
    if (st === 'error') return fail(t, 'פייסבוק דחה את הסרטון: ' + (v.status?.processing_phase?.error?.message || 'error'))
    if (tooLong(t)) return fail(t, 'פייסבוק לא סיים לעבד את הסרטון תוך 30 דקות')
    return save(t.id, { next_check_at: later(30) })
  }
  const classic = async (why: string) => {
    console.log('facebook: reel refused, posting as a page video:', why)
    const v = await graph(`${page}/videos`, { file_url: await signedVideoUrl(t.post.video_path), description: caption, published: 'true', access_token: token }, 'POST')
    return save(t.id, { container_id: `v:${v.id}`, external_id: v.id, started_at: now(), next_check_at: later(30), error: null })
  }

  const vid = t.container_id!
  const s = (await graph(vid, { fields: 'status,permalink_url', access_token: token })).status || {}
  const done = (x: any) => String(x?.status || '').startsWith('complete')
  const vs = String(s.video_status || '')
  if (['error', 'upload_failed', 'expired'].includes(vs) || s.processing_phase?.status === 'error' || s.publishing_phase?.status === 'error') {
    return classic(s.processing_phase?.error?.message || s.publishing_phase?.error?.message || vs)
  }
  if (!t.external_id) {
    // Not published yet: finish as soon as the upload itself is complete.
    // (For Reels, Facebook only starts processing after the finish call, so
    // waiting for "ready" first never ends.)
    if (vs === 'ready' || vs === 'upload_complete' || done(s.uploading_phase) || done(s.processing_phase)) {
      try {
        await graph(`${page}/video_reels`, {
          upload_phase: 'finish', video_id: vid, video_state: 'PUBLISHED', description: caption, access_token: token,
        }, 'POST')
      } catch (e) {
        // e.g. longer than 90 seconds: not a Reel, so post it as a page video
        if ((e as { transient?: boolean }).transient) throw e
        return classic((e as Error).message)
      }
      return save(t.id, { external_id: vid, next_check_at: later(30) })
    }
  } else if (done(s.publishing_phase) || s.publishing_phase?.status === 'published') {
    let permalink: string | null = null
    try {
      const p = (await graph(vid, { fields: 'permalink_url', access_token: token })).permalink_url
      permalink = p ? (p.startsWith('http') ? p : `https://www.facebook.com${p}`) : null
    } catch { /* optional */ }
    return save(t.id, { status: 'published', permalink, published_at: now(), error: null })
  }
  if (tooLong(t)) return fail(t, 'פייסבוק לא סיים לעבד את הסרטון תוך 30 דקות')
  return save(t.id, { next_check_at: later(30) })
}

// TikTok tokens live 24h; refresh (and save) when close to expiry.
async function tiktokAccess(acc: NonNullable<Target['account']>): Promise<string> {
  const tok = JSON.parse(acc.token) as TikTokToken
  if (acc.token_expires_at && new Date(acc.token_expires_at).getTime() > Date.now() + 5 * 60 * 1000) return tok.access
  const r = await refreshToken(tok.refresh)
  await patch('social_accounts', `id=eq.${acc.id}`, { token: JSON.stringify(r.token), token_expires_at: r.expires_at })
  return r.token.access
}

async function stepTiktok(t: Target, caption: string) {
  const access = await tiktokAccess(t.account!)
  if (t.status === 'pending') {
    const { video, type } = await videoBytes(t)
    const publishId = await startUpload(access, video, caption, type)
    return save(t.id, { status: 'processing', container_id: publishId, started_at: now(), next_check_at: later(30), error: null })
  }
  const s = await uploadStatus(access, t.container_id!)
  if (s.status === 'PUBLISH_COMPLETE' || s.status === 'SEND_TO_USER_INBOX') {
    const draft = s.status === 'SEND_TO_USER_INBOX' || !TIKTOK_DIRECT
    const pid = s.post_ids?.[0]
    await save(t.id, {
      status: 'published', published_at: now(), external_id: pid || null,
      permalink: pid ? `https://www.tiktok.com/@/video/${pid}` : null,
      error: draft ? 'נשלח כטיוטה: לפתוח את טיקטוק (התראות / Inbox) וללחוץ פרסם' : null,
    })
    // A draft waits for him in the TikTok app: tell him right away, not only
    // in the summary at the end.
    if (draft && (await getSetting('wa_social_alerts')) !== false) {
      const brand = BRAND_HE[t.post.brand] || t.post.brand
      await sendWhatsApp(`היי אדיר, תזמון עלה כעת ב-${brand} בטיקטוק.\nיש לפתוח את ההתראה באפליקציה ולאשר את הסרטון (Post, ציבורי).`)
    }
    return
  }
  if (s.status === 'FAILED') return fail(t, 'טיקטוק דחה את הסרטון: ' + (s.fail_reason || 'FAILED'))
  if (tooLong(t)) return fail(t, 'טיקטוק לא סיים לעבד את הסרטון תוך 30 דקות')
  return save(t.id, { next_check_at: later(30) })
}

async function videoBytes(t: Target): Promise<{ video: ArrayBuffer; type: string }> {
  const r = await fetch(await signedVideoUrl(t.post.video_path, 900))
  if (!r.ok) throw new Error('לא הצלחתי לקרוא את הסרטון מהאחסון (' + r.status + ')')
  return { video: await r.arrayBuffer(), type: t.post.video_path.endsWith('.mov') ? 'video/quicktime' : 'video/mp4' }
}

// YouTube: one step. The upload returns the video id right away; YouTube
// processes it on its side. container_id keeps the channel id (for stats).
async function stepYoutube(t: Target, caption: string) {
  let access: string
  try {
    access = await youtubeAccess(JSON.parse(t.account!.token).refresh)
  } catch (e) {
    if ((e as { revoked?: boolean }).revoked) {
      await patch('social_accounts', `id=eq.${t.account!.id}`, { status: 'expired' })
      return fail(t, 'הגישה ליוטיוב בוטלה. חבר את יוטיוב מחדש בממשק.')
    }
    throw e
  }
  const { video, type } = await videoBytes(t)
  const v = await uploadYoutube(access, video, caption, type)
  return save(t.id, {
    status: 'published', external_id: v.id, container_id: v.channelId || null, published_at: now(),
    permalink: `https://www.youtube.com/shorts/${v.id}`,
    // YouTube does not lock API uploads as private (YouTube API Services,
    // 3.11.2026); if one still comes back private, say so.
    error: !v.privacy || v.privacy === 'public' ? null : `יוטיוב שמר את הסרטון כ-${v.privacy}. אפשר לשנות לציבורי ב-YouTube Studio.`,
  })
}

// LinkedIn: one step (upload, finalize, post). Token lasts 60 days.
async function stepLinkedin(t: Target, caption: string) {
  const acc = t.account!
  if (acc.token_expires_at && new Date(acc.token_expires_at).getTime() < Date.now() + 60 * 1000) {
    await patch('social_accounts', `id=eq.${acc.id}`, { status: 'expired' })
    return fail(t, 'החיבור ללינקדאין פג (60 יום). חבר את לינקדאין מחדש בממשק ולחץ "נסה שוב".')
  }
  const { video } = await videoBytes(t)
  const p = await postLinkedinVideo(JSON.parse(acc.token).access, acc.external_id, video, caption)
  return save(t.id, { status: 'published', external_id: p.id || null, permalink: p.permalink, published_at: now(), error: null })
}

async function workTargets(deadline: number) {
  const list: Target[] = await rest(
    `social_targets?status=in.(pending,processing)&next_check_at=lte.${encodeURIComponent(now())}&order=next_check_at&limit=25` +
    `&select=id,post_id,platform,status,container_id,external_id,attempts,started_at,` +
    `post:social_posts(id,brand,video_path,caption,captions,status,options),account:social_accounts(id,platform,external_id,token,token_expires_at,parent_id,status)`,
  )
  for (const t of list || []) {
    if (Date.now() > deadline) break
    if (t.post?.status !== 'publishing') continue
    if (!(await claim(t.id))) continue
    if (!t.account?.token) { await fail(t, 'החשבון נותק. חבר אותו מחדש בממשק.'); continue }
    const caption = (t.post.captions?.[t.platform] || t.post.caption || '').trim()
    try {
      if (t.platform === 'instagram') await stepInstagram(t, caption.slice(0, 2200))
      else if (t.platform === 'facebook') await stepFacebook(t, caption)
      else if (t.platform === 'tiktok') await stepTiktok(t, caption.slice(0, 2200))
      else if (t.platform === 'youtube') await stepYoutube(t, caption)
      else if (t.platform === 'linkedin') await stepLinkedin(t, caption.slice(0, 3000))
      else await fail(t, NOT_CONNECTED[t.platform] || 'רשת לא נתמכת')
    } catch (e) {
      const err = e as Error & { transient?: boolean }
      const attempts = t.attempts + 1
      console.error('target', t.id, t.platform, err.message)
      if (err.transient && attempts < 4) await save(t.id, { attempts, error: err.message.slice(0, 500), next_check_at: later(120 * attempts) })
      else await save(t.id, { attempts, status: 'failed', error: err.message.slice(0, 500) })
    }
  }
}

// ---------- 3) finish posts, notify ----------
const isDraft = (t: { platform: string; status: string; error: string | null; external_id?: string | null }) =>
  t.platform === 'tiktok' && t.status === 'published' && !t.external_id && !!t.error?.startsWith('נשלח כטיוטה')
async function finalizePosts() {
  const posts = await rest(`social_posts?status=eq.publishing&select=id,brand,video_path,notified,targets:social_targets(platform,status,permalink,error,external_id)`)
  for (const p of posts || []) {
    const ts = (p.targets || []) as { platform: string; status: string; permalink: string | null; error: string | null }[]
    if (!ts.length || ts.some((t) => t.status === 'pending' || t.status === 'processing')) continue
    const ok = ts.filter((t) => t.status === 'published').length
    const status = ok === ts.length ? 'done' : ok > 0 ? 'partial' : 'failed'
    await patch('social_posts', `id=eq.${p.id}`, { status })
    // A TikTok draft still waits in the app: keep the file so it can be sent
    // again or downloaded. collectStats deletes it once the video is live
    // (or after 7 days).
    const draftWaiting = ts.some((t) => isDraft(t))
    if (status === 'done' && !draftWaiting) await deleteVideo(p.video_path)
    const claimNotify = await rest(`social_posts?id=eq.${p.id}&notified=eq.false`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ notified: true }),
    })
    if (!claimNotify?.length || (await getSetting('wa_social_alerts')) === false) continue
    const lines = [`🎬 פרסום ${BRAND_HE[p.brand] || p.brand}: עלה ב-${ok} מתוך ${ts.length}`, '']
    for (const t of ts) {
      const name = PLATFORM_HE[t.platform] || t.platform
      lines.push(t.status === 'published'
        ? `✅ ${name}${t.permalink ? ' - ' + t.permalink : ''}${t.error ? ' (' + t.error + ')' : ''}`
        : `❌ ${name}: ${t.error || 'נכשל'}`)
    }
    if (ok < ts.length) lines.push('', 'אפשר לנסות שוב מהממשק.')
    lines.push(`${DASH}#social`)
    await sendWhatsApp(lines.join('\n'))
  }
}

// ---------- 4) views and engagement (pg_cron every 3 hours, {"stats": true}) ----------
type StatTarget = {
  id: number; platform: string; external_id: string | null; container_id: string | null; published_at: string
  post: { video_path: string; status: string } | null
  account: NonNullable<Target['account']> | null
}
const metric = (d: any, name: string): number | null => {
  const v = d?.data?.find((x: any) => x.name === name)?.values?.[0]?.value
  return typeof v === 'number' ? v : null
}

async function collectStats(deadline: number) {
  const since = new Date(Date.now() - 60 * 864e5).toISOString()
  const list: StatTarget[] = await rest(
    `social_targets?status=eq.published&published_at=gte.${encodeURIComponent(since)}&order=published_at.asc&limit=300` +
    `&select=id,platform,external_id,container_id,published_at,post:social_posts(video_path,status),account:social_accounts(id,platform,external_id,token,token_expires_at,parent_id,status)`,
  )
  const taken = new Set((list || []).filter((t) => t.platform === 'tiktok' && t.external_id).map((t) => t.external_id))
  const tiktokVideos = new Map<number, TikTokVideo[]>()
  const ytFeeds = new Map<string, Map<string, { views: number | null; likes: number | null }>>()
  let done = 0
  for (const t of list || []) {
    if (Date.now() > deadline) break
    if (!t.account?.token) continue
    const token = t.account.token
    try {
      let stats: Record<string, unknown> = {}
      if (t.platform === 'instagram' && t.external_id) {
        const d = await graph(`${t.external_id}/insights`, { metric: 'views,reach,likes,comments,shares,saved', access_token: token })
        stats = { views: metric(d, 'views'), reach: metric(d, 'reach'), likes: metric(d, 'likes'), comments: metric(d, 'comments'), shares: metric(d, 'shares'), saves: metric(d, 'saved') }
        // Watch time (ms) and the share who scrolled away in the first 3 s.
        try {
          const w = await graph(`${t.external_id}/insights`, { metric: 'ig_reels_avg_watch_time,reels_skip_rate', access_token: token })
          const avg = metric(w, 'ig_reels_avg_watch_time'), skip = metric(w, 'reels_skip_rate')
          if (avg != null) stats.avg_watch_sec = Math.round(avg / 100) / 10
          if (skip != null) stats.skip_rate = skip
        } catch { /* optional metrics */ }
      } else if (t.platform === 'facebook' && t.external_id) {
        // One metric per call: Meta retires metrics over time (impressions
        // went first), and one unknown name fails the whole request.
        const one = async (name: string) => {
          try { return metric(await graph(`${t.external_id}/video_insights`, { metric: name, access_token: token }), name) } catch { return null }
        }
        let views: number | null = null
        for (const name of ['blue_reels_play_count', 'fb_reels_total_plays', 'post_video_views', 'total_video_views']) {
          views = await one(name)
          if (views != null) break
        }
        stats = { views, reach: await one('post_video_views_unique') }
        try {
          const w = await graph(`${t.external_id}/video_insights`, { metric: 'post_video_avg_time_watched', access_token: token })
          const avg = metric(w, 'post_video_avg_time_watched')
          if (avg != null) stats.avg_watch_sec = Math.round(avg / 100) / 10
        } catch { /* optional metric */ }
        try {
          const o = await graph(t.external_id, { fields: 'likes.summary(true).limit(0),comments.summary(true).limit(0)', access_token: token })
          stats.likes = o.likes?.summary?.total_count ?? null
          stats.comments = o.comments?.summary?.total_count ?? null
        } catch { /* counts are optional */ }
      } else if (t.platform === 'tiktok') {
        if (!tiktokVideos.has(t.account.id)) tiktokVideos.set(t.account.id, await listVideos(await tiktokAccess(t.account)))
        const videos = tiktokVideos.get(t.account.id) || []
        let v = t.external_id ? videos.find((x) => x.id === t.external_id) : undefined
        if (!v && !t.external_id) {
          // Sent as a draft: it is the first video he posted on that account
          // after we sent it (within 7 days) that no other post claimed.
          const sent = new Date(t.published_at).getTime() / 1000 - 300
          v = videos.filter((x) => x.create_time >= sent && x.create_time <= sent + 7 * 86400 && !taken.has(x.id))
            .sort((a, b) => a.create_time - b.create_time)[0]
          if (v) {
            taken.add(v.id); stats = { external_id: v.id, permalink: v.share_url || null, error: null }
            // The draft is live: the kept file is no longer needed.
            if (t.post?.status === 'done') await deleteVideo(t.post.video_path)
          }
        }
        if (!v) {
          // A draft nobody posted within 7 days: stop keeping its file.
          if (Date.now() - new Date(t.published_at).getTime() > 7 * 864e5 && t.post?.status === 'done') await deleteVideo(t.post.video_path)
          await patch('social_targets', `id=eq.${t.id}`, { stats_at: now(), stats_error: 'עוד לא פורסם באפליקציית טיקטוק' }); continue
        }
        stats = { ...stats, views: v.view_count ?? null, likes: v.like_count ?? null, comments: v.comment_count ?? null, shares: v.share_count ?? null }
      } else if (t.platform === 'youtube' && t.external_id && t.container_id) {
        if (!ytFeeds.has(t.container_id)) ytFeeds.set(t.container_id, await channelFeedStats(t.container_id))
        const v = ytFeeds.get(t.container_id)!.get(t.external_id)
        if (!v) { await patch('social_targets', `id=eq.${t.id}`, { stats_at: now(), stats_error: 'עוד לא ציבורי ביוטיוב' }); continue }
        stats = { views: v.views, likes: v.likes }
      } else continue
      await patch('social_targets', `id=eq.${t.id}`, { ...stats, stats_at: now(), stats_error: null })
      done++
    } catch (e) {
      await patch('social_targets', `id=eq.${t.id}`, { stats_at: now(), stats_error: (e as Error).message.slice(0, 300) })
    }
  }
  return done
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const deadline = Date.now() + BUDGET_MS
  const body = await req.json().catch(() => ({}))
  try {
    if (body?.stats) return json({ ok: true, updated: await collectStats(deadline) })
    await activateDuePosts()
    await workTargets(deadline)
    await finalizePosts()
    return json({ ok: true })
  } catch (e) {
    console.error('social-publish', e)
    return json({ ok: false, error: (e as Error).message }, 500)
  }
})
