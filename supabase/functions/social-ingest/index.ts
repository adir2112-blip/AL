// The video studio (C:\video-studio, on the owner's computer) sends finished
// videos here. Each one becomes a post "waiting for approval" (status review)
// in dashboard.html -> פרסומים, already optimized per network: texts and an
// hour per network on the next free day of the weekly rhythm. The owner gets a
// WhatsApp message; he approves (it is scheduled) or rejects with a reason
// (the studio reads it back through "status" and learns from it).
//
// Auth: header x-ingest-key = the Supabase secret STUDIO_INGEST_SECRET (the
// studio keeps the same value in auto/al-publish.secret).
//   POST {action:"upload", brand, ext}        -> { path, upload_url }  (PUT the file there)
//   POST {action:"create", brand, video_path, title, script, frames[], duration_sec, source_id, meta}
//        meta = which episode it is: {series_id, series_title, n, episode_title, opening, funny, characters}
//        (social-learn compares episodes by it)
//        stream: "main" (default) or "shorts" (automatic Callio Shorts, on their own days)
//        captions: optional {network: text} that win over the optimizer (e.g. the studio's SEO'd YouTube title)
//                                            -> { id, platform_times }
//   POST {action:"status", source_ids[]}      -> { posts: [...] }
// Deploy with: supabase functions deploy social-ingest --no-verify-jwt

import { CORS, DASH, SERVICE_KEY, SUPABASE_URL, getSetting, ingestKeyOk, json, rest, sendWhatsApp } from '../_shared/social.ts'

const BRAND_HE: Record<string, string> = { callio: 'Callio', stopzkor: 'StopZkor' }
const NET_HE: Record<string, string> = { instagram: 'אינסטגרם', facebook: 'פייסבוק', tiktok: 'טיקטוק', youtube: 'יוטיוב', linkedin: 'לינקדאין' }
const DAY_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

// "2026-11-15" + "19:30" in Israel time -> ISO (UTC)
function israelIso(date: string, hm: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = hm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0)
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]))
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)
  return new Date(guess - (local - guess)).toISOString()
}
const fmtIsrael = (iso: string) => {
  const d = new Date(iso)
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short' }).format(d)
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' }).format(d)
  return `${DAY_HE[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd)]} ${hm}`
}

async function signedUpload(path: string): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/social-videos/${encodeURI(path)}`, {
    method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, body: '{}',
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.url) throw new Error(`upload url ${r.status}: ${JSON.stringify(d).slice(0, 200)}`)
  return `${SUPABASE_URL}/storage/v1${d.url}`
}

async function create(body: Record<string, any>) {
  const brand = String(body.brand || '')
  if (!BRAND_HE[brand]) return json({ ok: false, error: 'unknown_brand' }, 400)
  const path = String(body.video_path || '')
  if (!path.startsWith(brand + '/studio-')) return json({ ok: false, error: 'bad_path' }, 400)
  const sourceId = String(body.source_id || '').slice(0, 200)
  if (sourceId) {
    const dup = await rest(`social_posts?source=eq.studio&source_id=eq.${encodeURIComponent(sourceId)}&status=neq.canceled&select=id`)
    if (dup?.length) return json({ ok: true, id: dup[0].id, duplicate: true })
  }
  const routes = ((await getSetting('social_routes')) || {}) as Record<string, string[]>
  const nets = routes[brand] || []
  const title = String(body.title || '').slice(0, 200)
  const script = String(body.script || '').slice(0, 4000)
  const m = body.meta && typeof body.meta === 'object' ? body.meta : {}
  const str = (v: unknown, n: number) => String(v ?? '').slice(0, n)
  const stream = body.stream === 'shorts' ? 'shorts' : 'main'
  const meta: Record<string, unknown> = m.series_id ? {
    series_id: str(m.series_id, 60), series_title: str(m.series_title, 120), n: Number(m.n) || null,
    episode_title: str(m.episode_title, 120), opening: str(m.opening, 300), funny: str(m.funny, 400),
    characters: Array.isArray(m.characters) ? m.characters.slice(0, 6).map((c: unknown) => str(c, 40)) : [],
  } : {}
  meta.stream = stream
  if (m.topic) meta.topic = str(m.topic, 60)
  if (m.opening && !meta.opening) meta.opening = str(m.opening, 300)

  // Texts and hours per network, from the same optimizer the dashboard uses.
  let captions: Record<string, string> = {}
  const times: Record<string, string> = {}
  let caption = title
  let note = ''
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/social-optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ingest-key': Deno.env.get('STUDIO_INGEST_SECRET') || '' },
      body: JSON.stringify({
        brand, stream, platforms: nets, frames: Array.isArray(body.frames) ? body.frames.slice(0, 3) : [],
        idea: `סרטון מהסטודיו: ${title}\nהטקסט שנאמר בסרטון:\n${script}`,
      }),
    })
    const d = await r.json()
    if (!r.ok || !d.ok) throw new Error(d.error || r.status)
    for (const p of d.platforms || []) {
      captions[p.platform] = p.post_text
      if (p.best_time?.hour && d.post_date) times[p.platform] = israelIso(d.post_date, p.best_time.hour)
    }
  } catch (e) {
    note = 'המיטוב לא הצליח (' + (e as Error).message + '). צריך לכתוב טקסט ולבחור שעות.'
    captions = {}
  }
  if (body.captions && typeof body.captions === 'object') {
    for (const n of nets) if (typeof body.captions[n] === 'string' && body.captions[n].trim()) captions[n] = str(body.captions[n], 5000)
  }
  caption = captions.instagram || captions.facebook || Object.values(captions)[0] || title
  const first = Object.values(times).sort()[0] || new Date(Date.now() + 864e5).toISOString()
  const ins = await rest('social_posts', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      brand, video_path: path, caption, captions, platforms: nets, scheduled_at: first, platform_times: times,
      status: 'review', source: 'studio', source_id: sourceId || null, title, script,
      duration_sec: Number(body.duration_sec) || null, options: {}, review_note: note || null, meta,
    }),
  })
  const post = ins?.[0]
  if ((await getSetting('wa_social_alerts')) !== false) {
    const lines = [`🎬 ${stream === 'shorts' ? 'Short אוטומטי חדש' : 'סרטון חדש מהסטודיו'} ממתין לאישור (${BRAND_HE[brand]})`, title ? `"${title}"` : '', '']
    for (const n of nets) lines.push(`${NET_HE[n] || n}: ${times[n] ? fmtIsrael(times[n]) : 'בלי שעה'}`)
    if (note) lines.push('', note)
    lines.push('', 'לצפייה, עריכה ואישור:', `${DASH}#social`)
    await sendWhatsApp(lines.filter((x, i) => x || i > 1).join('\n'))
  }
  return json({ ok: true, id: post?.id, platform_times: times })
}

async function status(body: Record<string, any>) {
  const ids = (Array.isArray(body.source_ids) ? body.source_ids : []).map(String).slice(0, 100)
  if (!ids.length) return json({ ok: true, posts: [] })
  const list = ids.map((x: string) => `"${x.replace(/"/g, '')}"`).join(',')
  const posts = await rest(
    `social_posts?source=eq.studio&source_id=in.(${encodeURIComponent(list)})` +
    `&select=id,source_id,status,reject_reason,reviewed_at,scheduled_at,targets:social_targets(platform,status,permalink,views,likes,avg_watch_sec,skip_rate)`,
  )
  return json({ ok: true, posts })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  if (!ingestKeyOk(req)) return json({ ok: false, error: 'unauthorized' }, 401)
  const body = await req.json().catch(() => ({}))
  try {
    if (body.action === 'upload') {
      const brand = String(body.brand || '')
      if (!BRAND_HE[brand]) return json({ ok: false, error: 'unknown_brand' }, 400)
      const ext = String(body.ext || 'mp4').toLowerCase() === 'mov' ? 'mov' : 'mp4'
      const path = `${brand}/studio-${Date.now()}-${crypto.randomUUID().slice(0, 6)}.${ext}`
      return json({ ok: true, path, upload_url: await signedUpload(path) })
    }
    if (body.action === 'create') return await create(body)
    if (body.action === 'status') return await status(body)
    return json({ ok: false, error: 'unknown_action' }, 400)
  } catch (e) {
    console.error('social-ingest', e)
    return json({ ok: false, error: (e as Error).message.slice(0, 300) }, 500)
  }
})
