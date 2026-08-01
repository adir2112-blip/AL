// Contact form endpoint for the A.L marketing site (adir2112-blip.github.io/AL)
// Deploy with: supabase functions deploy al-contact-form --no-verify-jwt
// Requires the RESEND_API_KEY secret to be set on this Supabase project.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const TO_EMAIL = 'adir2112@gmail.com'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid_json' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }

  const name = String(body.name ?? '').trim()
  const phone = String(body.phone ?? '').trim()
  const email = String(body.email ?? '').trim()
  const message = String(body.message ?? '').trim()

  if (!name || !phone) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_required_fields' }), {
      status: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }

  const html = `
    <div dir="rtl" style="font-family:Arial;padding:24px;max-width:600px">
      <h2 style="color:#362721;border-bottom:3px solid #C69A4E;padding-bottom:8px">
        פנייה חדשה מאתר A.L
      </h2>
      <table style="border-collapse:collapse;width:100%;margin-top:16px">
        <tr><td style="padding:6px 12px;color:#888">שם</td><td style="padding:6px 12px"><strong>${escapeHtml(name)}</strong></td></tr>
        <tr><td style="padding:6px 12px;color:#888">טלפון</td><td style="padding:6px 12px"><strong>${escapeHtml(phone)}</strong></td></tr>
        <tr><td style="padding:6px 12px;color:#888">אימייל</td><td style="padding:6px 12px">${escapeHtml(email) || '—'}</td></tr>
        <tr><td style="padding:6px 12px;color:#888;vertical-align:top">הודעה</td><td style="padding:6px 12px;white-space:pre-wrap">${escapeHtml(message) || '—'}</td></tr>
      </table>
      <p style="color:#888;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:12px">
        נשלח מטופס יצירת הקשר באתר A.L מערכות ופתרונות פיננסים
      </p>
    </div>
  `

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'A.L אתר <contact@resend.dev>',
      to: TO_EMAIL,
      reply_to: email || undefined,
      subject: `פנייה חדשה מהאתר — ${name}`,
      html
    })
  })

  const result = await res.json()
  return new Response(JSON.stringify({ ok: res.ok, result }), {
    status: res.ok ? 200 : 502,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  })
})
