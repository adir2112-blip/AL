// Lead endpoint for the A.L marketing site (al-systems.co.il)
// Used by the contact form (contact.html), the shift-scheduling calculator and
// the "leave your details" form on the final screen of every live demo (demo/*).
// Every lead is saved to public.leads (shown in dashboard.html -> ניהול לידים),
// emailed to the owner and (unless switched off in the dashboard) sent to his
// WhatsApp. Each lead carries its first-touch attribution: where the visitor
// came from, the landing page, pages and demos seen.
// Deploy with: supabase functions deploy al-contact-form --no-verify-jwt
// Requires the RESEND_API_KEY secret. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// are provided automatically by Supabase.

import { cleanAttribution, channelOf, describe } from '../_shared/attribution.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TO_EMAIL = 'adir2112@gmail.com'

// WhatsApp alert to the owner through his personal bot (Railway).
// With WA_BOT_SECRET set it uses the authenticated /api/external-send,
// otherwise the bot's open /api/send.
const WA_BOT_URL = 'https://whatsapp-bot-production-120a.up.railway.app'
const WA_BOT_SECRET = Deno.env.get('WA_BOT_SECRET') || ''
const OWNER_WA = '972509143496'

const DEMO_NAMES: Record<string, string> = {
  shiftsync: 'ShiftSync — סידור עבודה',
  stopzkor: 'StopZkor — הקלטת שיחות',
  callio: 'Callio — ניתוח שיחות',
  filemanager: 'FileManager — ניהול פניות',
  crm: 'CRM',
  learnix: 'LearnIx — ניהול ידע',
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const REST_HEADERS = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function clip(v: unknown, max: number): string {
  return String(v ?? '').trim().slice(0, max)
}

// Owner switch in dashboard.html -> הגדרות (public.site_settings).
// Defaults to ON if the setting can't be read, so a lead is never silently lost.
async function leadAlertsOn(): Promise<boolean> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/site_settings?key=eq.wa_lead_alerts&select=value`, { headers: REST_HEADERS })
    if (!r.ok) return true
    const rows = await r.json()
    return !(rows[0] && rows[0].value === false)
  } catch {
    return true
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }

  // honeypot: real visitors never see/fill this field
  if (clip(body.website, 200)) return json({ ok: true })

  const name = clip(body.name, 120)
  const phone = clip(body.phone, 30)
  const email = clip(body.email, 200)
  const message = clip(body.message, 4000)
  const source = body.source === 'demo' ? 'demo' : 'contact'
  const demoKey = clip(body.demo_name, 40).toLowerCase()
  const demo = source === 'demo' && DEMO_NAMES[demoKey] ? demoKey : ''
  const pagePath = clip(body.page_path, 300)
  const consent = body.marketing_consent === true
  const attribution = cleanAttribution(body.attribution)
  const channel = channelOf(attribution)
  const originLine = describe(attribution, channel, DEMO_NAMES)

  if (!name || phone.replace(/\D/g, '').length < 9) return json({ ok: false, error: 'missing_required_fields' }, 400)

  // 1) save the lead (the dashboard reads it from here)
  let saved = false
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: { ...REST_HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({
        name, phone,
        email: email || null,
        message: message || null,
        source,
        demo_name: demo || null,
        page_path: pagePath || null,
        marketing_consent: consent,
        channel,
        attribution
      })
    })
    saved = r.ok
    if (!r.ok) console.error('lead insert failed', r.status, await r.text())
  } catch (e) {
    console.error('lead insert error', e)
  }

  // 2) email the owner
  const origin = demo ? `הדמו של ${DEMO_NAMES[demo]}` : 'טופס יצירת הקשר'
  const html = `
    <div dir="rtl" style="font-family:Arial;padding:24px;max-width:600px">
      <h2 style="color:#362721;border-bottom:3px solid #C69A4E;padding-bottom:8px">
        ${demo ? 'ליד חדש מהדמו' : 'פנייה חדשה מאתר A.L'}
      </h2>
      <table style="border-collapse:collapse;width:100%;margin-top:16px">
        <tr><td style="padding:6px 12px;color:#888">שם</td><td style="padding:6px 12px"><strong>${escapeHtml(name)}</strong></td></tr>
        <tr><td style="padding:6px 12px;color:#888">טלפון</td><td style="padding:6px 12px"><strong>${escapeHtml(phone)}</strong></td></tr>
        <tr><td style="padding:6px 12px;color:#888">אימייל</td><td style="padding:6px 12px">${escapeHtml(email) || '—'}</td></tr>
        <tr><td style="padding:6px 12px;color:#888;vertical-align:top">הודעה</td><td style="padding:6px 12px;white-space:pre-wrap">${escapeHtml(message) || '—'}</td></tr>
        <tr><td style="padding:6px 12px;color:#888">טופס</td><td style="padding:6px 12px">${escapeHtml(origin)}${pagePath ? ' · ' + escapeHtml(pagePath) : ''}</td></tr>
        <tr><td style="padding:6px 12px;color:#888">הגיע מ</td><td style="padding:6px 12px">${escapeHtml(originLine)}</td></tr>
        <tr><td style="padding:6px 12px;color:#888">דיוור</td><td style="padding:6px 12px">${consent ? 'הסכים/ה לקבל עדכונים' : 'לא ביקש/ה עדכונים'}</td></tr>
      </table>
      <p style="margin-top:20px"><a href="https://al-systems.co.il/dashboard.html#leads" style="background:#C69A4E;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">לניהול הלידים</a></p>
      <p style="color:#888;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:12px">
        נשלח מ${escapeHtml(origin)} באתר A.L Systems${saved ? '' : ' · שימו לב: הליד לא נשמר בעמוד הניהול, רק במייל הזה'}
      </p>
    </div>
  `

  let mailed = false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'A.L אתר <contact@resend.dev>',
        to: TO_EMAIL,
        reply_to: email || undefined,
        subject: demo ? `ליד חדש מהדמו של ${DEMO_NAMES[demo]} — ${name}` : `פנייה חדשה מהאתר — ${name}`,
        html
      })
    })
    mailed = res.ok
    if (!res.ok) console.error('mail failed', res.status, await res.text())
  } catch (e) {
    console.error('mail error', e)
  }

  // 3) WhatsApp alert to the owner (can be switched off in the dashboard)
  let whatsapped = false
  const alertsOn = await leadAlertsOn()
  if (alertsOn) {
    try {
      const digits = phone.replace(/\D/g, '')
      const intl = digits.startsWith('0') ? '972' + digits.slice(1) : digits
      const lines = [
        demo ? `ליד חדש מהדמו של ${DEMO_NAMES[demo]}` : 'פנייה חדשה מהאתר',
        '',
        `שם: ${name}`,
        `טלפון: ${phone}`,
        email ? `אימייל: ${email}` : '',
        message ? `הודעה: ${message.slice(0, 600)}` : '',
        pagePath ? `עמוד: ${pagePath}` : '',
        `הגיע מ: ${originLine}`,
        consent ? 'הסכים/ה לקבל עדכונים' : '',
        '',
        `לוואטסאפ איתו: https://wa.me/${intl}`,
        'לניהול הלידים: https://al-systems.co.il/dashboard.html#leads'
      ].filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== ''))
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (WA_BOT_SECRET) headers.Authorization = `Bearer ${WA_BOT_SECRET}`
      const r = await fetch(`${WA_BOT_URL}${WA_BOT_SECRET ? '/api/external-send' : '/api/send'}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ phone: OWNER_WA, message: lines.join('\n'), source: 'אתר AL - לידים' })
      })
      whatsapped = r.ok
      if (!r.ok) console.error('whatsapp failed', r.status, await r.text())
    } catch (e) {
      console.error('whatsapp error', e)
    }
  }

  // the visitor's lead is safe if it reached any place
  const ok = saved || mailed || whatsapped
  return json({ ok, saved, mailed, whatsapped, channel }, ok ? 200 : 502)
})
