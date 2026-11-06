// Lead endpoint for the A.L marketing site (al-systems.co.il)
// Used by the contact form (contact.html) and by the "leave your details" form
// on the final screen of every live demo (demo/*).
// Every lead is saved to public.leads (shown in dashboard.html -> ניהול לידים)
// and emailed to the owner.
// Deploy with: supabase functions deploy al-contact-form --no-verify-jwt
// Requires the RESEND_API_KEY secret. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// are provided automatically by Supabase.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const TO_EMAIL = 'adir2112@gmail.com'

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

  if (!name || phone.replace(/\D/g, '').length < 9) return json({ ok: false, error: 'missing_required_fields' }, 400)

  // 1) save the lead (the dashboard reads it from here)
  let saved = false
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        name, phone,
        email: email || null,
        message: message || null,
        source,
        demo_name: demo || null,
        page_path: pagePath || null,
        marketing_consent: consent
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
        <tr><td style="padding:6px 12px;color:#888">מקור</td><td style="padding:6px 12px">${escapeHtml(origin)}${pagePath ? ' · ' + escapeHtml(pagePath) : ''}</td></tr>
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

  // the visitor's lead is safe if it reached either place
  return json({ ok: saved || mailed, saved, mailed }, saved || mailed ? 200 : 502)
})
