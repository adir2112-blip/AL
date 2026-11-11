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
//    Every step first claims the target, so overlapping runs never post twice.
// 3) When all targets of a post are done it is marked done / partial /
//    failed, the owner gets one WhatsApp summary, and (if everything was
//    published) the video file is deleted from storage.
// Deploy with: supabase functions deploy social-publish --no-verify-jwt

import {
  CORS, DASH, GRAPH_VERSION, deleteVideo, getSetting, graph, json, patch, rest, sendWhatsApp, signedVideoUrl,
} from '../_shared/social.ts'
import { TIKTOK_DIRECT, refreshToken, startUpload, uploadStatus, type TikTokToken } from '../_shared/tiktok.ts'

const BUDGET_MS = 100_000
const STEP_TIMEOUT_MIN = 30
const PLATFORM_HE: Record<string, string> = { instagram: 'אינסטגרם', facebook: 'פייסבוק', tiktok: 'טיקטוק', linkedin: 'לינקדאין' }
const BRAND_HE: Record<string, string> = { callio: 'Callio', stopzkor: 'StopZkor', al: 'A.L Systems' }
const NOT_CONNECTED: Record<string, string> = {
  linkedin: 'לינקדאין עוד לא מחובר למערכת (שלב הבא)',
}

const now = () => new Date().toISOString()
const later = (sec: number) => new Date(Date.now() + sec * 1000).toISOString()

type Target = {
  id: number; post_id: number; platform: string; status: string; container_id: string | null; external_id: string | null
  attempts: number; started_at: string | null
  post: { id: number; brand: string; video_path: string; caption: string; captions: Record<string, string>; status: string }
  account: { id: number; platform: string; external_id: string; token: string; token_expires_at: string | null; parent_id: string | null; status: string } | null
}

// ---------- 1) activate due posts ----------
async function activateDuePosts() {
  const due = await rest(`social_posts?status=eq.scheduled&scheduled_at=lte.${encodeURIComponent(now())}&select=id,brand,platforms&order=scheduled_at&limit=20`)
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
  const orphans = await rest(`social_posts?status=eq.publishing&select=id,brand,platforms,targets:social_targets(id)&limit=20`)
  for (const p of orphans || []) if (!p.targets?.length) await createTargets(p)
}

async function createTargets(p: { id: number; brand: string; platforms: string[] }) {
  const accounts = await rest(`social_accounts?brand=eq.${encodeURIComponent(p.brand)}&status=eq.ok&select=id,platform`)
  const byPlatform = new Map((accounts || []).map((a: any) => [a.platform, a.id]))
  // Every row has the same keys: PostgREST rejects a bulk insert otherwise.
  const rows = p.platforms.map((platform) => {
    const acc = byPlatform.get(platform) ?? null
    return {
      post_id: p.id, platform, account_id: acc, next_check_at: now(),
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
    const c = await graph(`${ig}/media`, {
      media_type: 'REELS', video_url: videoUrl, caption, share_to_feed: 'true', access_token: token,
    }, 'POST')
    return save(t.id, { status: 'processing', container_id: c.id, started_at: now(), next_check_at: later(40), error: null })
  }
  const s = await graph(t.container_id!, { fields: 'status_code,status', access_token: token })
  if (s.status_code === 'FINISHED') {
    const pub = await graph(`${ig}/media_publish`, { creation_id: t.container_id!, access_token: token }, 'POST')
    let permalink: string | null = null
    try { permalink = (await graph(pub.id, { fields: 'permalink', access_token: token })).permalink || null } catch { /* link is a nice-to-have */ }
    return save(t.id, { status: 'published', external_id: pub.id, permalink, published_at: now(), error: null })
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
  const vid = t.container_id!
  const s = (await graph(vid, { fields: 'status,permalink_url', access_token: token })).status || {}
  const done = (x: any) => String(x?.status || '').startsWith('complete')
  const vs = String(s.video_status || '')
  if (['error', 'upload_failed', 'expired'].includes(vs) || s.processing_phase?.status === 'error' || s.publishing_phase?.status === 'error') {
    return fail(t, 'פייסבוק דחה את הסרטון: ' + (s.processing_phase?.error?.message || s.publishing_phase?.error?.message || vs))
  }
  if (!t.external_id) {
    // Not published yet: finish once Facebook has processed the upload.
    if (vs === 'ready' || done(s.processing_phase)) {
      await graph(`${page}/video_reels`, {
        upload_phase: 'finish', video_id: vid, video_state: 'PUBLISHED', description: caption, access_token: token,
      }, 'POST')
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
    const r = await fetch(await signedVideoUrl(t.post.video_path, 900))
    if (!r.ok) throw new Error('לא הצלחתי לקרוא את הסרטון מהאחסון (' + r.status + ')')
    const video = await r.arrayBuffer()
    const type = t.post.video_path.endsWith('.mov') ? 'video/quicktime' : 'video/mp4'
    const publishId = await startUpload(access, video, caption, type)
    return save(t.id, { status: 'processing', container_id: publishId, started_at: now(), next_check_at: later(30), error: null })
  }
  const s = await uploadStatus(access, t.container_id!)
  if (s.status === 'PUBLISH_COMPLETE' || s.status === 'SEND_TO_USER_INBOX') {
    const draft = s.status === 'SEND_TO_USER_INBOX' || !TIKTOK_DIRECT
    const pid = s.post_ids?.[0]
    return save(t.id, {
      status: 'published', published_at: now(), external_id: pid || null,
      permalink: pid ? `https://www.tiktok.com/@/video/${pid}` : null,
      error: draft ? 'נשלח כטיוטה: לפתוח את טיקטוק (התראות / Inbox) וללחוץ פרסם' : null,
    })
  }
  if (s.status === 'FAILED') return fail(t, 'טיקטוק דחה את הסרטון: ' + (s.fail_reason || 'FAILED'))
  if (tooLong(t)) return fail(t, 'טיקטוק לא סיים לעבד את הסרטון תוך 30 דקות')
  return save(t.id, { next_check_at: later(30) })
}

async function workTargets(deadline: number) {
  const list: Target[] = await rest(
    `social_targets?status=in.(pending,processing)&next_check_at=lte.${encodeURIComponent(now())}&order=next_check_at&limit=25` +
    `&select=id,post_id,platform,status,container_id,external_id,attempts,started_at,` +
    `post:social_posts(id,brand,video_path,caption,captions,status),account:social_accounts(id,platform,external_id,token,token_expires_at,parent_id,status)`,
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
async function finalizePosts() {
  const posts = await rest(`social_posts?status=eq.publishing&select=id,brand,video_path,notified,targets:social_targets(platform,status,permalink,error)`)
  for (const p of posts || []) {
    const ts = (p.targets || []) as { platform: string; status: string; permalink: string | null; error: string | null }[]
    if (!ts.length || ts.some((t) => t.status === 'pending' || t.status === 'processing')) continue
    const ok = ts.filter((t) => t.status === 'published').length
    const status = ok === ts.length ? 'done' : ok > 0 ? 'partial' : 'failed'
    await patch('social_posts', `id=eq.${p.id}`, { status })
    if (status === 'done') await deleteVideo(p.video_path)
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const deadline = Date.now() + BUDGET_MS
  try {
    await activateDuePosts()
    await workTargets(deadline)
    await finalizePosts()
    return json({ ok: true })
  } catch (e) {
    console.error('social-publish', e)
    return json({ ok: false, error: (e as Error).message }, 500)
  }
})
