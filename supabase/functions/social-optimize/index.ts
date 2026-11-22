// "מטב לכל רשת" in dashboard.html -> פרסומים.
// The owner describes the video (and the browser sends 3 frames from it);
// Claude returns, per network: the hook, the full post text, hashtags, who to
// tag, the best day and hour to post, and a hook to put on the video itself.
// It learns from our own results: the brand's best and worst videos by views
// (with their captions) and views by weekday/hour go into every request.
// {action:"cover"}: the browser sends up to 8 frames of the video; Claude
// picks the strongest cover image -> { pick (index), why }.
// Owner only (his login token). Requires the ANTHROPIC_API_KEY secret.
// Deploy with: supabase functions deploy social-optimize --no-verify-jwt

import Anthropic from 'npm:@anthropic-ai/sdk@1.7.0'
import { CORS, ingestKeyOk, isOwner, json, rest } from '../_shared/social.ts'

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '' })

const NET_HE: Record<string, string> = { instagram: 'אינסטגרם', facebook: 'פייסבוק', tiktok: 'טיקטוק', youtube: 'יוטיוב', linkedin: 'לינקדאין' }
const NETS = Object.keys(NET_HE)

// Facts only: the model may not claim anything that is not here.
const BRANDS: Record<string, string> = {
  callio: `Callio: מערכת AI שמנתחת שיחות טלפון של עסקים (מכירות ושירות) בשביל מנהלים.
מה היא עושה: מתמללת את השיחות, נותנת ציון ותובנות לכל שיחה, ומראה למנהל מה קורה בשיחות של העובדים (למשל נציג שהבטיח ללקוח משהו).
קהל: בעלי עסקים ומנהלים עם צוות מכירות או מוקד שירות בישראל.
החשבונות שלנו: אינסטגרם @callioaio, טיקטוק @callioai, עמוד פייסבוק Callio, ערוץ יוטיוב Callio. בלינקדאין הפוסט עולה בפרופיל האישי של המייסד, אדיר לוי.`,
  stopzkor: `StopZkor: אפליקציה שמקליטה שיחות טלפון, מתמללת ומסכמת אותן בעברית, ומזכירה לך כל הבטחה שנתת בשיחה (למשל לשלוח הצעת מחיר).
המידע נשמר אצל המשתמש במכשיר. לאייפון ולאנדרואיד. באנדרואיד יש 60 דקות ניסיון חינם. אתר: stopzkor.co.il
קהל: עצמאים, אנשי מכירות ובעלי עסקים קטנים שמדברים הרבה בטלפון.
פיתוח משותף של A.L ו-Azria Solutions.
החשבונות שלנו: אינסטגרם @stopzkor, טיקטוק @stopzkor4, עמוד פייסבוק StopZkor.`,
}

const RULES = `כללי כל רשת (לסרטון קצר אנכי):
- אינסטגרם (Reels): השורה הראשונה היא ההוק, עד 125 תווים, כי אחריה הטקסט נקטע ב"עוד". אחריה 2-4 שורות קצרות עם ערך, קריאה לפעולה שמתאימה לאינסטגרם (שמרו, שלחו למישהו שצריך, תגיבו מילה) ו-3-5 האשטגים ממוקדים בסוף. עד 2,200 תווים.
- טיקטוק: טקסט קצר מאוד, משפט או שניים. ההוק בהתחלה, קריאה לפעולה קצרה (עקבו לחלק 2 / תגיבו) ו-3-5 האשטגים, שאחד מהם רחב (למשל #טיפים או #עסקים).
- פייסבוק: פתיחה שעוצרת גלילה (שאלה או טענה מפתיעה), 2-3 משפטים, קריאה לתגובה או שאלה לקהל, 0-2 האשטגים.
- יוטיוב (Shorts): השורה הראשונה של post_text היא כותרת הסרטון, עד 90 תווים, עם ההוק ומילים שאנשים באמת מחפשים ביוטיוב (בלי האשטגים בכותרת). אחריה שורה ריקה ותיאור של 1-3 משפטים, ובסוף 3 האשטגים שאחד מהם #shorts.
- לינקדאין: טון מקצועי וענייני. פתיחה במשפט אחד חזק, אחריו פסקה קצרה עם תובנה מעסקים אמיתיים, שאלה לדיון בסוף, 3 האשטגים מקצועיים. בלי אימוג'ים מוגזמים.

כללים לכל הטקסטים:
- עברית טבעית, ישראלית, כמו בעל עסק שמדבר. בלי מילים גבוהות ובלי ניסוחים של AI ("בעולם של היום", "מהפכה", "בואו נצלול", "לא רק... אלא גם", "הגיע הזמן").
- בלי מקפים ארוכים (—). בלי להמציא נתונים, מחירים, לקוחות, ציטוטים או יכולות שלא כתובים בתיאור המותג.
- הוק = הבטחה או מתח מהשנייה הראשונה: כאב מוכר ("שכחת להחזיר ללקוח?"), מספר, טעות נפוצה, או "מה שאף אחד לא מספר לך על...". לא לפתוח בשם המותג.
- תיוג: לתייג רק את החשבונות שלנו שמופיעים בתיאור המותג. לא להמציא שמות משתמש של אחרים. אם כדאי לתייג סוג של שותף (למשל לקוח שמופיע בסרטון), לכתוב את זה כהמלצה ב-tips, בלי @.
- זמן פרסום: היום כבר נקבע (מופיע בבקשה) וכל הרשתות עולות באותו יום. אתה בוחר רק שעה לכל רשת, שעון ישראל, בשעות שונות באותו יום.
  בבקשה מופיעה "שעה מחושבת" לכל רשת, מהצפיות שלנו (כולל בדיקה מכוונת של שעות חדשות כדי ללמוד). להחזיר בדיוק אותה שעה ואותו הסבר ב-why, בלי לשנות.
  אם הפרסום היום והשעה של רשת כבר עברה (מופיע בבקשה מה השעה עכשיו), לבחור שעה מאוחרת יותר באותו יום.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['video_summary', 'onscreen_hook', 'platforms'],
  properties: {
    video_summary: { type: 'string', description: 'משפט אחד: מה רואים ושומעים בסרטון לפי התמונות והתיאור' },
    onscreen_hook: { type: 'string', description: 'טקסט קצר לשים על הסרטון עצמו בשנייה הראשונה, עד 8 מילים' },
    platforms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['platform', 'hook', 'post_text', 'hashtags', 'mentions', 'best_time', 'tips'],
        properties: {
          platform: { type: 'string', enum: NETS },
          hook: { type: 'string', description: 'השורה הראשונה של הפוסט' },
          post_text: { type: 'string', description: 'הטקסט המלא מוכן להדבקה: הוק, גוף, קריאה לפעולה, תיוגים והאשטגים בסוף' },
          hashtags: { type: 'array', items: { type: 'string' } },
          mentions: { type: 'array', items: { type: 'string' }, description: 'רק חשבונות שלנו מתיאור המותג, עם @' },
          best_time: {
            type: 'object',
            additionalProperties: false,
            required: ['hour', 'why'],
            properties: {
              hour: { type: 'string', description: 'HH:MM שעון ישראל, ביום שנקבע' },
              why: { type: 'string' },
            },
          },
          tips: { type: 'array', items: { type: 'string' }, description: '1-3 טיפים קצרים לרשת הזו (תיוגים, צליל, קאבר, אורך)' },
        },
      },
    },
  },
}

type Row = { platform: string; views: number | null; likes: number | null; avg_watch_sec?: number | null; skip_rate?: number | null; published_at: string; post: { brand: string; caption: string; captions: Record<string, string> } | null }

const DAY_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']
function israelSlot(iso: string) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.find((x) => x.type === 'weekday')?.value || '')
  return { day: DAY_HE[wd] || '?', hour: Number(p.find((x) => x.type === 'hour')?.value || 0) }
}

// ---- the posting hour per network, decided here from our own numbers (not by
// the model, which kept repeating the same default hours, so nothing new was
// ever tried and nothing could be learned):
//  - each hour we posted at gets its average views (videos under 2 days old are
//    left out, their views are still climbing);
//  - normally the best hour so far wins;
//  - every third post on a network, or while fewer than 4 different hours were
//    tried, it tests an hour we haven't tried yet, next to the best one;
//  - LinkedIn reports no views, so it rotates through its candidate hours. ----
const CANDIDATES: Record<string, number[]> = {
  linkedin: [8, 12, 9, 17, 13, 7, 18],
  facebook: [13, 20, 12, 21, 19, 14, 9],
  instagram: [20, 19, 21, 13, 22, 18, 12],
  tiktok: [21, 22, 20, 19, 23, 17, 13],
  youtube: [18, 20, 19, 21, 17, 15, 13],
}
type Slot = { platform: string; views: number | null; published_at: string }
function hourOf(iso: string) { return israelSlot(iso).hour }
function planNet(net: string, all: Slot[]): { hour: number; why: string } {
  const cand = CANDIDATES[net] || [12, 19]
  const posts = all.filter((x) => x.platform === net)
  const tried = new Set(posts.map((x) => hourOf(x.published_at)))
  const untried = cand.filter((h) => !tried.has(h))
  const old = posts.filter((x) => x.views != null && Date.now() - new Date(x.published_at).getTime() > 2 * 864e5)
  if (!old.length) {
    const h = untried[0] ?? cand[posts.length % cand.length]
    return { hour: h, why: net === 'linkedin' ? 'בלינקדאין אין לנו נתוני צפיות, אז מחליפים שעה כל פעם כדי לגוון' : 'עוד אין מספיק צפיות ברשת הזו, בודקים שעה חדשה' }
  }
  const by = new Map<number, number[]>()
  for (const x of old) { const h = hourOf(x.published_at); by.set(h, [...(by.get(h) || []), x.views || 0]) }
  const stats = [...by.entries()].map(([h, v]) => ({ h, avg: Math.round(v.reduce((a, b) => a + b, 0) / v.length), n: v.length })).sort((a, b) => b.avg - a.avg)
  const best = stats[0]
  const explore = untried.length > 0 && (by.size < 4 || posts.length % 3 === 2)
  if (explore) {
    const near = [...untried].sort((a, b) => Math.abs(a - best.h) - Math.abs(b - best.h))[0]
    return { hour: near, why: `בודקים שעה חדשה (${near}:00). הכי טוב עד עכשיו: ${best.h}:00, ממוצע ${best.avg} צפיות (${best.n} סרטונים)` }
  }
  const second = stats[1]
  return { hour: best.h, why: `לפי הצפיות שלנו: ${best.h}:00 הכי חזקה, ממוצע ${best.avg} צפיות (${best.n} סרטונים)${second ? `, לעומת ${second.h}:00 עם ${second.avg}` : ''}` }
}
async function timePlan(brand: string, nets: string[]) {
  const since = new Date(Date.now() - 120 * 864e5).toISOString()
  const rows = await rest(
    `social_targets?status=eq.published&published_at=gte.${encodeURIComponent(since)}&select=platform,views,published_at,post:social_posts(brand)&limit=1000`,
  ).catch(() => [])
  const mine: Slot[] = (rows || []).filter((r: any) => r.post?.brand === brand)
  const plan: Record<string, { hour: number; why: string }> = {}
  for (const n of nets) plan[n] = planNet(n, mine)
  return plan
}

// What worked for this brand so far, per network.
async function history(brand: string): Promise<string> {
  const since = new Date(Date.now() - 120 * 864e5).toISOString()
  const rows: Row[] = await rest(
    `social_targets?status=eq.published&views=not.is.null&published_at=gte.${encodeURIComponent(since)}` +
    `&select=platform,views,likes,avg_watch_sec,skip_rate,published_at,post:social_posts(brand,caption,captions,duration_sec)&order=views.desc&limit=400`,
  ).catch(() => [])
  const mine = (rows || []).filter((r) => r.post?.brand === brand)
  if (!mine.length) return 'עוד אין נתוני צפיות מהחשבונות שלנו. תן המלצות כלליות וכתוב שהן כלליות.'
  const out: string[] = []
  for (const net of NETS) {
    const r = mine.filter((x) => x.platform === net)
    if (!r.length) continue
    const text = (x: Row) => (x.post?.captions?.[net] || x.post?.caption || '').replace(/\s+/g, ' ').slice(0, 160)
    const line = (x: Row) => {
      const s = israelSlot(x.published_at)
      const watch = x.avg_watch_sec != null ? `, צפייה ממוצעת ${x.avg_watch_sec} שנ'` : ''
      const skip = x.skip_rate != null ? `, ${Math.round(x.skip_rate)}% גללו ב-3 שניות` : ''
      return `  - ${x.views} צפיות, ${x.likes ?? '?'} לייקים${watch}${skip}, יום ${s.day} ${s.hour}:00 | "${text(x)}"`
    }
    out.push(`${NET_HE[net]} (${r.length} סרטונים):`)
    out.push(' הכי חזקים:', ...r.slice(0, 5).map(line))
    if (r.length > 5) out.push(' הכי חלשים:', ...r.slice(-5).map(line))
    if (r.length >= 6) {
      const by = new Map<string, number[]>()
      for (const x of r) {
        const s = israelSlot(x.published_at)
        const k = `${s.day} ${s.hour < 12 ? 'בוקר' : s.hour < 17 ? 'צהריים' : 'ערב'}`
        by.set(k, [...(by.get(k) || []), x.views || 0])
      }
      const avg = [...by.entries()].map(([k, v]) => [k, Math.round(v.reduce((a, b) => a + b, 0) / v.length), v.length] as const)
        .sort((a, b) => b[1] - a[1]).slice(0, 4)
      out.push(' ממוצע צפיות לפי זמן פרסום: ' + avg.map(([k, a, n]) => `${k}: ${a} (${n})`).join(', '))
    }
  }
  return out.join('\n')
}

// ---- which day: the next free day in the weekly rhythm (Sun/Tue/Thu by default,
// site_settings.social_cadence = {"days": [0, 2, 4]}). Every network of a video
// goes out that same day; the model only picks the hour per network. ----
function israelParts(d: Date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)?.value || ''
  return {
    date: `${g('year')}-${g('month')}-${g('day')}`,
    wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')),
    hm: `${g('hour')}:${g('minute')}`,
    hour: Number(g('hour')),
  }
}

// Two streams per brand, each on its own days: "main" (series episodes and
// what the owner uploads) and "shorts" (the studio's automatic Callio Shorts,
// social_cadence.shorts_days, default Mon/Wed/Fri).
async function pickDay(brand: string, stream = 'main'): Promise<{ date: string; day: string; why: string; nowHm: string }> {
  const cadence = await rest(`site_settings?key=eq.social_cadence&select=value`).then((r) => r?.[0]?.value).catch(() => null)
  const days: number[] = stream === 'shorts'
    ? (Array.isArray(cadence?.shorts_days) ? cadence.shorts_days : [1, 3, 5])
    : (Array.isArray(cadence?.days) ? cadence.days : [0, 2, 4])
  // days already taken by this brand's scheduled or running posts of the same stream
  const all = await rest(`social_posts?brand=eq.${encodeURIComponent(brand)}&status=in.(review,scheduled,publishing)&select=scheduled_at,platform_times,meta`).catch(() => [])
  const posts = (all || []).filter((p: any) => (p.meta?.stream || 'main') === stream)
  const taken = new Set<string>()
  for (const p of posts) {
    taken.add(israelParts(new Date(p.scheduled_at)).date)
    for (const t of Object.values(p.platform_times || {})) taken.add(israelParts(new Date(t as string)).date)
  }
  const now = israelParts(new Date())
  const names = days.map((x) => DAY_HE[x]).join(', ')
  for (let i = 0; i < 21; i++) {
    const d = israelParts(new Date(Date.now() + i * 864e5))
    if (!days.includes(d.wd) || taken.has(d.date)) continue
    if (i === 0 && now.hour >= 11) continue // too late today for the midday slots
    return { date: d.date, day: DAY_HE[d.wd], why: `קצב של ${days.length} סרטונים בשבוע (${names}): זה היום הפנוי הבא${taken.size ? ' אחרי מה שכבר מתוזמן' : ''}.`, nowHm: now.hm }
  }
  const d = israelParts(new Date(Date.now() + 864e5))
  return { date: d.date, day: DAY_HE[d.wd], why: 'כל ימי הקצב בשבועות הקרובים תפוסים, אז מחר.', nowHm: now.hm }
}

// ---- when our Instagram followers are online (Instagram insights,
// online_followers: last 30 days, accounts with 100+ followers) ----
async function igAudience(brand: string): Promise<string> {
  try {
    const acc = (await rest(`social_accounts?platform=eq.instagram&brand=eq.${encodeURIComponent(brand)}&status=eq.ok&select=external_id,token&limit=1`))?.[0]
    if (!acc?.token) return ''
    const g = async (path: string) => (await fetch(`https://graph.facebook.com/v27.0/${path}&access_token=${encodeURIComponent(acc.token)}`)).json()
    const info = await g(`${acc.external_id}?fields=followers_count`)
    if ((info.followers_count ?? 0) < 100) return `(באינסטגרם יש ${info.followers_count ?? '?'} עוקבים. אינסטגרם נותן שעות פעילות של עוקבים רק מ-100 עוקבים.)`
    const d = await g(`${acc.external_id}/insights?metric=online_followers&period=lifetime`)
    const values: { value?: Record<string, number> }[] = d?.data?.[0]?.values || []
    const sum = new Array(24).fill(0)
    let n = 0
    for (const v of values) {
      if (!v.value) continue
      n++
      for (const [h, c] of Object.entries(v.value)) sum[Number(h)] += c
    }
    if (!n) return ''
    // Instagram reports these hours in Pacific time: shift them to Israel time.
    const at = (tz: string) => new Date(new Date().toLocaleString('en-US', { timeZone: tz })).getTime()
    const shift = Math.round((at('Asia/Jerusalem') - at('America/Los_Angeles')) / 3600e3)
    const top = sum.map((c, h) => ({ h: (h + shift + 24) % 24, c: Math.round(c / n) })).sort((a, b) => b.c - a.c).slice(0, 5)
    return `שעות שבהן הכי הרבה עוקבים שלנו באינסטגרם מחוברים (שעון ישראל, ממוצע 30 יום): ${top.map((x) => `${String(x.h).padStart(2, '0')}:00 (${x.c})`).join(', ')}`
  } catch {
    return ''
  }
}

const COVER_SCHEMA = {
  type: 'object',
  properties: {
    pick: { type: 'integer', description: 'מספר התמונה שנבחרה (מתחיל ב-1)' },
    why: { type: 'string', description: 'משפט אחד קצר בעברית פשוטה: למה דווקא היא' },
  },
  required: ['pick', 'why'],
  additionalProperties: false,
}

// The cover image: the frame that makes people stop scrolling and tap.
async function pickCover(brand: string, frames: string[], title: string, script: string) {
  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  frames.forEach((data, i) => {
    content.push({ type: 'text', text: `תמונה ${i + 1}:` })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })
  })
  content.push({
    type: 'text',
    text: `המותג:\n${BRANDS[brand]}\n\n${title ? `כותרת הסרטון: ${title}\n` : ''}${script ? `מה נאמר בסרטון:\n${script.slice(0, 3000)}\n` : ''}\n` +
      `התמונות לפי סדר הזמן בסרטון. איזו מהן הכי טובה כתמונת שער (Cover) לסרטון קצר אנכי ברשתות?`,
  })
  const msg = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: COVER_SCHEMA } },
    system: 'אתה מנהל הסושיאל של A.L Systems ובוחר תמונת שער לסרטון. שער טוב: חד ולא מטושטש, לא באמצע מעבר בין סצנות, ' +
      'פנים או מוצר ברורים, טקסט על המסך שקריא ומסקרן אם יש, וצבעים חזקים. לא לבחור מסך שחור, לבן, ריק או מסך סיום עם לוגו בלבד.',
    messages: [{ role: 'user', content }],
  })
  if (msg.stop_reason === 'refusal') throw new Error('הבקשה נדחתה')
  const out = JSON.parse(msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''))
  const pick = Math.min(frames.length, Math.max(1, Math.round(Number(out.pick) || 1))) - 1
  return { pick, why: String(out.why || '').slice(0, 300) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  if (!ingestKeyOk(req) && !(await isOwner(req))) return json({ ok: false, error: 'unauthorized' }, 401)
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ ok: false, error: 'ANTHROPIC_API_KEY חסר ב-Supabase' }, 500)

  const body = await req.json().catch(() => ({}))
  const brand = String(body.brand || '')
  if (!BRANDS[brand]) return json({ ok: false, error: 'unknown_brand' }, 400)
  if (body.action === 'cover') {
    const frames = (Array.isArray(body.frames) ? body.frames : []).filter((f: unknown) => typeof f === 'string' && f.length < 400_000).slice(0, 8)
    if (frames.length < 2) return json({ ok: false, error: 'no_frames' }, 400)
    try {
      return json({ ok: true, ...(await pickCover(brand, frames, String(body.title || '').slice(0, 300), String(body.script || ''))) })
    } catch (e) {
      console.error('social-optimize cover', e)
      return json({ ok: false, error: (e as Error).message.slice(0, 300) }, 502)
    }
  }
  const nets = (Array.isArray(body.platforms) ? body.platforms : []).filter((n: string) => NET_HE[n]).slice(0, 5)
  if (!nets.length) return json({ ok: false, error: 'no_platforms' }, 400)
  const idea = String(body.idea || '').slice(0, 5000)
  const frames = (Array.isArray(body.frames) ? body.frames : []).filter((f: unknown) => typeof f === 'string' && f.length < 1_500_000).slice(0, 3)

  const content: Anthropic.Beta.BetaContentBlockParam[] = frames.map((data: string) => ({
    type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data },
  }))
  const [day, audience, past, plan] = await Promise.all([pickDay(brand, body.stream === 'shorts' ? 'shorts' : 'main'), igAudience(brand), history(brand), timePlan(brand, nets)])
  const today = israelParts(new Date()).date
  // posting today: an hour that already passed moves to the next candidate still ahead
  if (day.date === today) {
    const nowH = israelParts(new Date()).hour
    for (const n of nets) {
      if (plan[n].hour > nowH) continue
      const later = (CANDIDATES[n] || []).filter((h) => h > nowH).sort((a, b) => a - b)[0]
      plan[n] = later != null ? { hour: later, why: `השעה המומלצת כבר עברה היום, אז ${later}:00. ${plan[n].why}` } : { hour: 23, why: `מאוחר היום, אז 23:00. ${plan[n].why}` }
    }
  }
  const hm = (h: number) => `${String(h).padStart(2, '0')}:00`
  const planText = nets.map((n: string) => `${NET_HE[n]}: ${hm(plan[n].hour)} (${plan[n].why})`).join('\n')
  content.push({
    type: 'text',
    text: (day.date === today
      ? `היום שנקבע לפרסום: היום, יום ${day.day} ${day.date}. השעה עכשיו בישראל: ${day.nowHm}, אז לבחור רק שעות שעוד לא עברו.\n\n`
      : `היום שנקבע לפרסום: יום ${day.day} ${day.date}. זה לא היום, אלא יום עתידי, אז כל שעות היום פתוחות. לא להתחשב בשעה הנוכחית.\n\n`) +
      `המותג:\n${BRANDS[brand]}\n\nמה אדיר כתב על הסרטון:\n${idea || '(לא כתב. להבין מהתמונות.)'}\n\n` +
      `${frames.length ? `מצורפות ${frames.length} תמונות מתוך הסרטון (התחלה, אמצע, סוף).\n\n` : ''}` +
      `הרשתות לפרסום: ${nets.map((n: string) => NET_HE[n]).join(', ')}. להחזיר פריט אחד לכל רשת, רק לרשתות האלה.\n\n` +
      `שעה מחושבת לכל רשת (להחזיר אותה כמו שהיא):\n${planText}\n\n` +
      `מה עבד אצלנו עד עכשיו:\n${past}` + (audience ? `\n\n${audience}` : ''),
  })

  try {
    const msg = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: `אתה מנהל הסושיאל של A.L Systems. אתה מכין לכל סרטון גרסה מותאמת לכל רשת, כדי שיגיע לכמה שיותר אנשים מהקהל הנכון. אדיר מאשר כל טקסט לפני פרסום.\n\n${RULES}`,
      messages: [{ role: 'user', content }],
    })
    if (msg.stop_reason === 'refusal') return json({ ok: false, error: 'הבקשה נדחתה. נסה לנסח את התיאור אחרת.' }, 422)
    const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
    const out = JSON.parse(text)
    // the hour is decided by the code above, never by the model
    for (const p of out.platforms || []) if (plan[p.platform]) p.best_time = { hour: hm(plan[p.platform].hour), why: plan[p.platform].why }
    return json({ ok: true, post_date: day.date, post_day: day.day, day_why: day.why, audience, ...out })
  } catch (e) {
    console.error('social-optimize', e)
    return json({ ok: false, error: (e as Error).message.slice(0, 300) }, 502)
  }
})
