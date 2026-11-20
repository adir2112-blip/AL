// Weekly backup of the AL site database (Supabase free plan = no automatic backups).
// Every public table is read with the service role and mailed to the owner as a
// gzipped JSON attachment (Resend). Secrets are left out: social_accounts.token
// is blanked and social_oauth_states is skipped. A failure is sent to the
// owner's WhatsApp, so it can't fail silently.
// Triggers:
//   - pg_cron, Sundays 05:00-09:00 UTC hourly (migration 20261120210000): sends
//     once per Sunday, from 08:00 Israel time;
//   - the owner (dashboard session) with {"force": true}: sends now;
//   - {"first_run": true}: once, only while no backup was ever made.
// Deploy with: supabase functions deploy al-backup --no-verify-jwt
import { CORS, json, rest, isOwner, sendWhatsApp, SUPABASE_URL, SERVICE_KEY, OWNER_EMAIL } from '../_shared/social.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || ''
const SKIP = new Set(['social_oauth_states'])
const BLANK: Record<string, string[]> = { social_accounts: ['token'] }

function israelNow() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const g = (t: string) => p.find((x) => x.type === t)?.value || ''
  return { weekday: g('weekday'), hour: Number(g('hour')), date: `${g('year')}-${g('month')}-${g('day')}` }
}

async function tableNames(): Promise<string[]> {
  const rows = await rest('rpc/al_backup_tables', { method: 'POST', body: '{}' })
  return (rows || []).map((r: { table_name: string }) => r.table_name).filter((t: string) => !SKIP.has(t))
}

async function dumpTable(t: string): Promise<unknown[]> {
  const out: unknown[] = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
    })
    if (!r.ok) throw new Error(`${t}: ${r.status} ${(await r.text()).slice(0, 120)}`)
    const page = await r.json()
    for (const row of page) for (const c of BLANK[t] || []) if (c in row) row[c] = row[c] ? '[removed]' : row[c]
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

async function gzipBase64(text: string): Promise<{ b64: string; bytes: number }> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  const buf = new Uint8Array(await new Response(stream).arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return { b64: btoa(bin), bytes: buf.length }
}

async function runBackup(date: string) {
  const tables: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}
  for (const t of await tableNames()) {
    tables[t] = await dumpTable(t)
    counts[t] = tables[t].length
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const { b64, bytes } = await gzipBase64(JSON.stringify({ exported_at: new Date().toISOString(), project: 'iwixjlfbifsbxtyppvqb', tables }))
  const list = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<tr><td style="padding:2px 10px">${t}</td><td style="padding:2px 10px">${n}</td></tr>`).join('')
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'A.L אתר <contact@resend.dev>',
      to: OWNER_EMAIL,
      subject: `גיבוי שבועי – אתר A.L – ${date}`,
      html: `<div dir="rtl" style="font-family:Arial"><h3>גיבוי שבועי של מסד הנתונים של אתר A.L</h3><p>${total} שורות ב-${Object.keys(counts).length} טבלאות. הקובץ המצורף הוא JSON דחוס (gz). שמרו אותו, הוא הגיבוי היחיד של המסד.</p><table style="border-collapse:collapse;font-size:13px">${list}</table><p style="color:#888;font-size:12px">אסימוני ההתחברות לרשתות החברתיות לא נכללים בגיבוי.</p></div>`,
      attachments: [{ filename: `al-backup-${date}.json.gz`, content: b64 }],
    }),
  })
  if (!r.ok) throw new Error(`mail ${r.status}: ${(await r.text()).slice(0, 200)}`)
  await rest('site_settings?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key: 'backup_last', value: { date, at: new Date().toISOString(), tables: Object.keys(counts).length, rows: total, bytes } }),
  })
  return { tables: Object.keys(counts).length, rows: total, bytes }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  let body: { force?: boolean; first_run?: boolean } = {}
  try { body = await req.json() } catch { /* cron sends {} */ }
  const now = israelNow()
  const owner = body.force ? await isOwner(req) : false
  if (body.force && !owner) return json({ ok: false, error: 'owner only' }, 401)
  if (!owner) {
    const last = (await rest('site_settings?key=eq.backup_last&select=value'))?.[0]?.value
    // {"first_run": true}: one immediate run while no backup was ever made (setup check)
    const firstRun = body.first_run === true && !last
    if (!firstRun) {
      if (now.weekday !== 'Sun' || now.hour < 8) return json({ ok: true, skipped: 'not the time' })
      if (last?.date === now.date) return json({ ok: true, skipped: 'already sent today' })
    }
  }
  try {
    const r = await runBackup(now.date)
    return json({ ok: true, ...r })
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300)
    console.error('al-backup', msg)
    await sendWhatsApp(`🛑 הגיבוי השבועי של אתר A.L נכשל\n${msg}\nאפשר להריץ שוב מהדשבורד או לבקש ממני לבדוק.`).catch(() => {})
    return json({ ok: false, error: msg }, 500)
  }
})
