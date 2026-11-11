// Weekly WhatsApp report for the A.L site owner.
// Fired by pg_cron every Sunday morning (see migration 20261109120000). It is
// idempotent: it sends at most once per week, only on Sunday from 08:00
// Israel time, and only while "wa_weekly_report" is on in the dashboard
// (public.site_settings). The owner can also send a sample on demand from the
// dashboard: that call carries his login token and skips the schedule checks.
// Deploy with: supabase functions deploy al-weekly-report --no-verify-jwt

import { CHANNEL_LABELS } from '../_shared/attribution.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const OWNER_EMAIL = 'adir2112@gmail.com'
const WA_BOT_URL = 'https://whatsapp-bot-production-120a.up.railway.app'
const WA_BOT_SECRET = Deno.env.get('WA_BOT_SECRET') || ''
const OWNER_WA = '972509143496'
const SEO_STATUS_URL = 'https://al-systems.co.il/data/seo-status.json'
const DASH = 'https://al-systems.co.il/dashboard.html'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const REST = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

type Week = { from: string; to: string; clicks: number; impressions: number; queries: number; top10: number }
type Tracked = { query: string; current: { position: number; impressions: number } | null; previous: { position: number; impressions: number } | null }
type Opportunity = { query: string; page: string; position: number; impressions: number; kind?: string }

function israelNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
  return { weekday: get('weekday'), hour: Number(get('hour')), date: `${get('year')}-${get('month')}-${get('day')}` }
}

async function getSetting(key: string): Promise<unknown> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/site_settings?key=eq.${key}&select=value`, { headers: REST })
  if (!r.ok) return undefined
  const rows = await r.json()
  return rows[0]?.value
}
async function setSetting(key: string, value: unknown) {
  await fetch(`${SUPABASE_URL}/rest/v1/site_settings?on_conflict=key`, {
    method: 'POST',
    headers: { ...REST, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  })
}

async function isOwner(req: Request): Promise<boolean> {
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token || token.split('.').length !== 3) return false
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } })
    if (!r.ok) return false
    const u = await r.json()
    return String(u.email || '').toLowerCase() === OWNER_EMAIL
  } catch {
    return false
  }
}

const fmtDay = (s: string) => { const p = s.split('-'); return p.length === 3 ? `${+p[2]}.${+p[1]}` : s }
function delta(cur: number, prev: number): string {
  const d = cur - prev
  if (d === 0) return 'ללא שינוי'
  const pct = prev > 0 ? ` (${d > 0 ? '+' : ''}${Math.round((d / prev) * 100)}%)` : ''
  return `${d > 0 ? '▲ +' : '▼ '}${d}${pct}`
}

function buildMessage(seo: Record<string, unknown> | null, leads: { created_at: string; channel: string | null }[], social: string[] = []) {
  const out: string[] = ['📊 דוח שבועי - אתר A.L Systems', '']
  const weekly = seo?.weekly as { current: Week; previous: Week } | undefined
  if (weekly?.current) {
    const c = weekly.current, p = weekly.previous
    out.push(`גוגל, ${fmtDay(c.from)}-${fmtDay(c.to)} מול השבוע שלפניו:`)
    out.push(`• הופעות: ${c.impressions} (${delta(c.impressions, p.impressions)})`)
    out.push(`• חיפושים שונים: ${c.queries} (${delta(c.queries, p.queries)})`)
    out.push(`• בעמוד הראשון: ${c.top10} (${delta(c.top10, p.top10)})`)
    out.push(`• קליקים לאתר: ${c.clicks} (${delta(c.clicks, p.clicks)})`)
  } else {
    out.push('נתוני גוגל השבועיים עוד לא זמינים.')
  }

  const now = Date.now(), wk = 7 * 864e5
  const thisWeek = leads.filter((l) => now - Date.parse(l.created_at) < wk)
  const lastWeek = leads.filter((l) => { const a = now - Date.parse(l.created_at); return a >= wk && a < 2 * wk })
  out.push('', `לידים ב-7 הימים האחרונים: ${thisWeek.length} (שבוע קודם: ${lastWeek.length})`)
  if (thisWeek.length) {
    const by: Record<string, number> = {}
    for (const l of thisWeek) { const k = l.channel || 'direct'; by[k] = (by[k] || 0) + 1 }
    out.push('• ' + Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${CHANNEL_LABELS[k] || k}: ${n}`).join(' · '))
  }

  const tracked = (seo?.tracked as Tracked[] | undefined) || []
  const moves = tracked
    .filter((t) => t.current && t.previous)
    .map((t) => ({ q: t.query, from: t.previous!.position, to: t.current!.position, d: t.previous!.position - t.current!.position }))
    .filter((m) => Math.abs(m.d) >= 1)
    .sort((a, b) => b.d - a.d)
  const appeared = tracked.filter((t) => t.current && !t.previous)
  const vanished = tracked.filter((t) => !t.current && t.previous && t.previous.impressions >= 3)
  if (moves.length || appeared.length || vanished.length) {
    out.push('', 'ביטויי המפתח:')
    const up = moves.filter((m) => m.d > 0)[0]
    const down = moves.filter((m) => m.d < 0).slice(-1)[0]
    if (up) out.push(`• עלה הכי הרבה: "${up.q}" ממקום ${up.from} למקום ${up.to}`)
    if (down) out.push(`• ירד הכי הרבה: "${down.q}" ממקום ${down.from} למקום ${down.to}`)
    if (appeared[0]) out.push(`• חדש: "${appeared[0].query}" במקום ${appeared[0].current!.position}`)
    if (vanished[0]) out.push(`• לא הופענו השבוע ב: "${vanished[0].query}"`)
  }

  const opp = ((seo?.opportunities as Opportunity[] | undefined) || [])[0]
  out.push('', 'הפעולה לשבוע:')
  if (opp) {
    const page = opp.page.replace('https://al-systems.co.il', '') || '/'
    out.push(opp.kind === 'ctr'
      ? `לשפר את הכותרת של ${page}: מופיע במקום ${opp.position} ב"${opp.query}" אבל לא מקבל קליקים. הבוט יציע כותרת חדשה לאישור.`
      : `לחזק את ${page}: במקום ${opp.position} ב"${opp.query}", קרוב לעמוד הראשון. הבוט יכין חיזוק לאישור.`)
  } else {
    out.push('להמשיך בתוכנית: פוסטים חדשים ואישור החיזוקים שהבוט פותח.')
  }
  if (social.length) out.push('', ...social)
  out.push('', `לדשבורד: ${DASH}#seo`, `לכיבוי הדוח: ${DASH}#settings`)
  return out.join('\n')
}

// Videos published from dashboard.html -> פרסומים in the last 7 days: views
// per brand and the network that brought the most.
type SocialRow = { platform: string; views: number | null; post: { brand: string } | null }
function socialSection(rows: SocialRow[]): string[] {
  const NET: Record<string, string> = { instagram: 'אינסטגרם', facebook: 'פייסבוק', tiktok: 'טיקטוק', linkedin: 'לינקדאין' }
  const BRAND: Record<string, string> = { callio: 'Callio', stopzkor: 'StopZkor' }
  const by: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    if (r.views == null || !r.post) continue
    const b = (by[r.post.brand] ||= {})
    b[r.platform] = (b[r.platform] || 0) + r.views
  }
  const brands = Object.keys(by)
  if (!brands.length) return []
  const out = ['🎬 צפיות בסרטונים (7 ימים)']
  for (const b of brands) {
    const nets = Object.entries(by[b]).sort((x, y) => y[1] - x[1])
    const total = nets.reduce((s, [, v]) => s + v, 0)
    out.push(`${BRAND[b] || b}: ${total.toLocaleString('he-IL')} (${nets.map(([n, v]) => `${NET[n] || n} ${v.toLocaleString('he-IL')}`).join(', ')})`)
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const manual = await isOwner(req)
  const il = israelNow()
  if (!manual) {
    if (il.weekday !== 'Sun' || il.hour < 8) return json({ ok: true, skipped: 'not_sunday_morning' })
    if ((await getSetting('wa_weekly_report')) === false) return json({ ok: true, skipped: 'disabled' })
    if ((await getSetting('weekly_report_last')) === il.date) return json({ ok: true, skipped: 'already_sent' })
    // claim the slot first so overlapping cron calls can't double-send
    await setSetting('weekly_report_last', il.date)
  }

  let seo: Record<string, unknown> | null = null
  try {
    const r = await fetch(`${SEO_STATUS_URL}?t=${Date.now()}`)
    if (r.ok) seo = await r.json()
  } catch (e) {
    console.error('seo status fetch failed', e)
  }
  let leads: { created_at: string; channel: string | null }[] = []
  try {
    const since = new Date(Date.now() - 14 * 864e5).toISOString()
    const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?select=created_at,channel&created_at=gte.${since}`, { headers: REST })
    if (r.ok) leads = await r.json()
  } catch (e) {
    console.error('leads fetch failed', e)
  }

  let social: string[] = []
  try {
    const since = new Date(Date.now() - 7 * 864e5).toISOString()
    const r = await fetch(`${SUPABASE_URL}/rest/v1/social_targets?status=eq.published&published_at=gte.${since}&select=platform,views,post:social_posts(brand)`, { headers: REST })
    if (r.ok) social = socialSection(await r.json())
  } catch (e) {
    console.error('social stats fetch failed', e)
  }

  const message = (manual ? '(דוח לדוגמה, נשלח מהדשבורד)\n' : '') + buildMessage(seo, leads, social)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (WA_BOT_SECRET) headers.Authorization = `Bearer ${WA_BOT_SECRET}`
  const r = await fetch(`${WA_BOT_URL}${WA_BOT_SECRET ? '/api/external-send' : '/api/send'}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ phone: OWNER_WA, message, source: 'אתר AL - דוח שבועי' }),
  })
  if (!r.ok) {
    console.error('whatsapp failed', r.status, await r.text())
    if (!manual) await setSetting('weekly_report_last', null) // let the next hourly run retry
    return json({ ok: false, error: 'whatsapp_failed' }, 502)
  }
  return json({ ok: true, sent: true, manual })
})
