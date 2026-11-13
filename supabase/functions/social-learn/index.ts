// What worked and what did not: the video studio (C:\video-studio) writes the
// next episodes of each brand's series with the lessons from here, and
// dashboard.html -> פרסומים shows the same lessons.
//
// Every video is measured at the same point: 48 hours after it went out
// (social_targets.views_48h etc., taken by social-publish). Until then, or for
// videos from before the snapshot existed, its current numbers are used.
// Per network a video's views are compared with that network's median for the
// brand, so a strong TikTok does not hide a weak Instagram.
//
// Lessons are drawn by Claude only from these numbers, once there are at least
// MIN_MEASURED measured videos, and again when new measured videos arrive or a
// week has passed. Rejections from the approval queue (with their reasons) go
// in too.
//
// Auth: the owner's login token, or x-ingest-key (the studio).
// Each brand has two streams ("main": series episodes and manual uploads;
// "shorts": the automatic Callio Shorts); each gets its own lessons.
//   POST {brand, stream?}        -> {measured, need, lessons:[{i,text,evidence}], top, bottom, networks, rejects}
//   POST {brand, refresh:true}   -> the same, lessons drawn again now
//   POST {action:"hide", id, i}  -> removes lesson i of lessons row id
// Requires the ANTHROPIC_API_KEY secret.
// Deploy with: supabase functions deploy social-learn --no-verify-jwt

import Anthropic from 'npm:@anthropic-ai/sdk@1.7.0'
import { CORS, ingestKeyOk, isOwner, json, rest } from '../_shared/social.ts'

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '' })
const MIN_MEASURED = 4
const STALE_MS = 7 * 864e5
const NET_HE: Record<string, string> = { instagram: 'אינסטגרם', facebook: 'פייסבוק', tiktok: 'טיקטוק', youtube: 'יוטיוב', linkedin: 'לינקדאין' }
const BRAND_HE: Record<string, string> = { callio: 'Callio', stopzkor: 'StopZkor' }

type Net = { net: string; views: number; watch_pct: number | null; skip: number | null; at48: boolean }
type Video = {
  id: number; title: string; episode: string; opening: string; funny: string; duration: number | null
  age_h: number; measured: boolean; nets: Net[]; score: number | null; total: number
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0
}
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d

async function collect(brand: string, stream: string) {
  const all = await rest(
    `social_posts?brand=eq.${brand}&status=in.(done,partial)&order=id.desc&limit=80` +
    `&select=id,title,caption,script,duration_sec,meta,targets:social_targets(platform,status,published_at,views,avg_watch_sec,skip_rate,views_48h,watch_48h,skip_48h,snap_at)`,
  ) || []
  const posts = all.filter((p: any) => (p.meta?.stream || 'main') === stream)
  const videos: Video[] = []
  for (const p of posts) {
    const live = (p.targets || []).filter((t: any) => t.status === 'published' && t.published_at)
    if (!live.length) continue
    const first = Math.min(...live.map((t: any) => Date.parse(t.published_at)))
    const age_h = (Date.now() - first) / 3600e3
    const dur = Number(p.duration_sec) || null
    const nets: Net[] = live
      .filter((t: any) => t.platform !== 'linkedin') // member posts expose no numbers to this app
      .map((t: any) => {
        const at48 = !!t.snap_at
        const views = Number(at48 ? t.views_48h : t.views) || 0
        const watch = at48 ? t.watch_48h : t.avg_watch_sec
        const skip = at48 ? t.skip_48h : t.skip_rate
        return {
          net: t.platform, views, at48,
          watch_pct: watch != null && dur ? Math.min(100, Math.round((Number(watch) / dur) * 100)) : null,
          skip: skip != null ? Number(skip) : null,
        }
      })
    const m = p.meta || {}
    const opening = String(m.opening || (p.script || '').split('\n')[0] || '').slice(0, 160)
    videos.push({
      id: p.id,
      title: String(m.episode_title ? `פרק ${m.n || '?'}: ${m.episode_title}` : p.title || (p.caption || '').split('\n')[0]).slice(0, 120),
      episode: m.series_title ? `${m.series_title}${m.n ? ` פרק ${m.n}` : ''}` : '',
      opening, funny: String(m.funny || '').slice(0, 200), duration: dur ? Math.round(dur) : null,
      age_h: Math.round(age_h), measured: age_h >= 48, nets, score: null,
      total: nets.reduce((s, n) => s + n.views, 0),
    })
  }
  // Per network: views against the brand's median there; the video's score is the average ratio
  const measured = videos.filter((v) => v.measured)
  const med: Record<string, number> = {}
  for (const net of Object.keys(NET_HE)) {
    const vals = measured.flatMap((v) => v.nets.filter((n) => n.net === net).map((n) => n.views))
    if (vals.length) med[net] = Math.max(1, median(vals))
  }
  for (const v of measured) {
    const r = v.nets.filter((n) => med[n.net]).map((n) => n.views / med[n.net])
    v.score = r.length ? round(r.reduce((a, b) => a + b, 0) / r.length, 2) : null
  }
  const networks = Object.keys(med).map((net) => {
    const rows = measured.flatMap((v) => v.nets.filter((n) => n.net === net))
    const w = rows.map((n) => n.watch_pct).filter((x): x is number => x != null)
    const s = rows.map((n) => n.skip).filter((x): x is number => x != null)
    return {
      net, name: NET_HE[net], videos: rows.length, median_views: Math.round(median(rows.map((n) => n.views))),
      watch_pct: w.length ? Math.round(median(w)) : null, skip: s.length ? Math.round(median(s)) : null,
    }
  })
  const ranked = measured.filter((v) => v.score != null).sort((a, b) => (b.score! - a.score!))
  const rejects = (await rest(
    `social_posts?brand=eq.${brand}&source=eq.studio&status=eq.canceled&reject_reason=not.is.null&order=id.desc&limit=15&select=id,title,reject_reason,meta`,
  ) || []).filter((p: any) => (p.meta?.stream || 'main') === stream).map((p: any) => ({ title: String(p.meta?.episode_title || p.title || ''), reason: String(p.reject_reason) }))
  return { videos, measured: measured.length, ranked, networks, rejects }
}

async function draw(brand: string, stream: string, data: Awaited<ReturnType<typeof collect>>) {
  const line = (v: Video) =>
    `- ${v.title}${v.episode ? ` (${v.episode})` : ''}${v.duration ? `, ${v.duration} שניות` : ''}. ציון ${v.score} (1 = חציון). ` +
    v.nets.map((n) => `${NET_HE[n.net]}: ${n.views} צפיות${n.watch_pct != null ? `, נצפה ${n.watch_pct}%` : ''}${n.skip != null ? `, דילגו ${n.skip}%` : ''}`).join('; ') +
    (v.opening ? `\n  פתיחה: "${v.opening}"` : '') + (v.funny ? `\n  הפאנץ': ${v.funny}` : '')
  const content =
    (stream === 'shorts'
      ? `המותג: ${BRAND_HE[brand]}. הסטודיו מפיק לו אוטומטית 3 סרטוני Shorts בשבוע (עד 30 שניות, קריין וצילומי מסך של המוצר), כל אחד על נושא אחר מהאתר.\n\n`
      : `המותג: ${BRAND_HE[brand]}. הסטודיו מפיק לו סדרת רשת מצוירת בעברית, 3 פרקים בשבוע של עד דקה.\n\n`) +
    `כל הסרטונים שנמדדו (48 שעות אחרי שעלו), מהטוב לחלש:\n${data.ranked.map(line).join('\n')}\n\n` +
    `לפי רשת (חציון):\n${data.networks.map((n) => `- ${n.name}: ${n.median_views} צפיות${n.watch_pct != null ? `, נצפה ${n.watch_pct}% מהסרטון` : ''}${n.skip != null ? `, ${n.skip}% דילגו מיד` : ''} (${n.videos} סרטונים)`).join('\n')}` +
    (data.rejects.length ? `\n\nפרקים שאדיר דחה לפני פרסום, והסיבה:\n${data.rejects.map((r) => `- ${r.title}: ${r.reason}`).join('\n')}` : '')
  const msg = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'medium',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object', additionalProperties: false, required: ['lessons'],
          properties: {
            lessons: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false, required: ['text', 'evidence'],
                properties: { text: { type: 'string' }, evidence: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    system:
      (stream === 'shorts' ? 'אתה העורך של סרטוני Shorts שיווקיים. אתה מקבל' : 'אתה העורך של סדרת רשת מצוירת. אתה מקבל') +
      ' את המספרים של הפרקים שכבר עלו, ומחזיר לקחים לצוות הכותבים לפרקים הבאים.\n' +
      'כללים:\n' +
      '- 3 עד 6 לקחים. כל לקח הוא הוראה מעשית אחת לכתיבה או לעריכה (פתיחה, אורך, סוג הבדיחה, קצב, נושא, דמות, סיום), בעברית פשוטה, עד 25 מילים.\n' +
      '- רק מה שהמספרים מראים. כל לקח מבוסס על השוואה בין פרקים (evidence: איזה פרקים ומה המספרים, במשפט אחד). אם ההבדל קטן או מבוסס על פרק אחד, לא לכתוב אותו.\n' +
      '- "דילגו" = אחוז שגללו הלאה בשנייה הראשונה: הבעיה היא הפתיחה. "נצפה %" נמוך = הקהל עזב באמצע: הבעיה היא הקצב או האורך.\n' +
      '- סיבות דחייה של אדיר הן לקח בפני עצמו: מה לא לעשות שוב.\n' +
      '- לא להמציא נתונים ולא לתת עצות כלליות שלא קשורות למספרים (כמו "להשתמש בהאשטגים").',
    messages: [{ role: 'user', content }],
  })
  if (msg.stop_reason === 'refusal') throw new Error('refusal')
  const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
  return (JSON.parse(text).lessons || [])
    .map((l: any) => ({ text: String(l.text || '').trim(), evidence: String(l.evidence || '').trim() }))
    .filter((l: any) => l.text)
    .slice(0, 6)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  if (!ingestKeyOk(req) && !(await isOwner(req))) return json({ ok: false, error: 'unauthorized' }, 401)
  const body = await req.json().catch(() => ({}))
  try {
    if (body.action === 'hide') {
      const row = (await rest(`social_lessons?id=eq.${Number(body.id)}&select=id,hidden`))?.[0]
      if (!row) return json({ ok: false, error: 'not_found' }, 404)
      const hidden = [...new Set([...(row.hidden || []), Number(body.i)])]
      await rest(`social_lessons?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ hidden }) })
      return json({ ok: true, hidden })
    }
    const brand = String(body.brand || '')
    if (!BRAND_HE[brand]) return json({ ok: false, error: 'unknown_brand' }, 400)
    const stream = body.stream === 'shorts' ? 'shorts' : 'main'
    const data = await collect(brand, stream)
    let row = (await rest(`social_lessons?brand=eq.${brand}&stream=eq.${stream}&order=created_at.desc&limit=1&select=id,lessons,hidden,based_on,created_at`))?.[0]
    const stale = !row || row.based_on !== data.measured || Date.now() - Date.parse(row.created_at) > STALE_MS
    let note = ''
    if (data.measured >= MIN_MEASURED && (stale || body.refresh)) {
      if (!Deno.env.get('ANTHROPIC_API_KEY')) note = 'ANTHROPIC_API_KEY חסר ב-Supabase'
      else {
        try {
          const lessons = await draw(brand, stream, data)
          if (lessons.length) {
            row = (await rest('social_lessons', {
              method: 'POST', headers: { Prefer: 'return=representation' },
              body: JSON.stringify({ brand, stream, lessons, based_on: data.measured }),
            }))?.[0] || row
          }
        } catch (e) {
          console.error('social-learn draw', e)
          note = 'הפקת הלקחים נכשלה, מוצגים הקודמים'
        }
      }
    }
    const hidden = new Set<number>(row?.hidden || [])
    const lessons = data.measured >= MIN_MEASURED || row
      ? (row?.lessons || []).map((l: any, i: number) => ({ i, ...l })).filter((l: any) => !hidden.has(l.i))
      : []
    const brief = (v: Video) => ({ id: v.id, title: v.title, score: v.score, total: v.total, duration: v.duration, nets: v.nets })
    return json({
      ok: true, brand, stream, measured: data.measured, need: Math.max(0, MIN_MEASURED - data.measured),
      lessons_id: row?.id ?? null, lessons_at: row?.created_at ?? null, lessons, note,
      top: data.ranked.slice(0, 3).map(brief),
      bottom: data.ranked.length > 3 ? data.ranked.slice(-3).reverse().map(brief) : [],
      networks: data.networks, rejects: data.rejects.slice(0, 5),
      waiting: data.videos.filter((v) => !v.measured).map((v) => ({ id: v.id, title: v.title, age_h: v.age_h, total: v.total })),
    })
  } catch (e) {
    console.error('social-learn', e)
    return json({ ok: false, error: (e as Error).message.slice(0, 300) }, 500)
  }
})
