// "מוקד מכירות": every change an agent makes, and the owner's actions that
// need the service role (creating logins, importing from Google).
// Agent (signed in on sales.html):
//   {action:"log_call", lead_id, status, meeting_at?, callback_at?, note?}
//   {action:"clock", dir:"in"|"out"}
// Owner (dashboard.html):
//   {action:"create_agent", username, name, password, hourly_rate?, phone?}
//   {action:"set_password", agent_id, password}
//   {action:"assign", agent_id|null, lead_ids?:[], industry?, city?, count?}
//   {action:"import_places", industry, city, query?, max?}   (GOOGLE_PLACES_KEY)
//   {action:"add_leads", industry, rows:[{business, phone, contact_name?, city?, address?, website?}]}
// A booked meeting is announced to the owner on WhatsApp.
// Deploy with: supabase functions deploy sales --no-verify-jwt

import { CORS, json, rest, sendWhatsApp, SUPABASE_URL, SERVICE_KEY, OWNER_EMAIL } from '../_shared/social.ts'

const AGENT_DOMAIN = 'agents.al-systems.co.il' // agents sign in with "username"; auth stores username@this
const STATUSES = ['no_answer', 'callback', 'meeting', 'not_interested']
const clip = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n)

async function whoIs(req: Request): Promise<{ email: string; id: string } | null> {
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token || token.split('.').length !== 3) return null
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } })
  if (!r.ok) return null
  const u = await r.json()
  return { email: String(u.email || '').toLowerCase(), id: String(u.id || '') }
}

// Israeli numbers to one form: 972XXXXXXXXX
function normPhone(p: string): string | null {
  let d = String(p || '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('0')) d = '972' + d.slice(1)
  if (!d.startsWith('972')) d = '972' + d
  return /^972\d{8,9}$/.test(d) ? d : null
}

function when(v: unknown): string | null {
  if (!v) return null
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? null : d.toISOString()
}

const fmt = (iso: string) => new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })

// ---------- agent ----------
async function logCall(agent: any, b: any) {
  const status = String(b.status || '')
  if (!STATUSES.includes(status)) throw new Error('סטטוס לא תקין')
  const lead = (await rest(`sales_leads?id=eq.${Number(b.lead_id)}&agent_id=eq.${agent.id}&select=*`))?.[0]
  if (!lead) throw new Error('הליד לא משויך אליך')
  const meeting_at = status === 'meeting' ? when(b.meeting_at) : null
  const callback_at = status === 'callback' ? when(b.callback_at) : null
  if (status === 'meeting' && !meeting_at) throw new Error('בחר תאריך ושעה לפגישה')
  if (status === 'callback' && !callback_at) throw new Error('בחר מתי לחזור')
  const note = clip(b.note, 2000) || null
  await rest('sales_calls', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ lead_id: lead.id, agent_id: agent.id, industry: lead.industry, status, meeting_at, callback_at, note }),
  })
  const stamp = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
  const notes = note ? clip(`${lead.notes ? lead.notes + '\n' : ''}${stamp} ${agent.name}: ${note}`, 4000) : lead.notes
  await rest(`sales_leads?id=eq.${lead.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status, meeting_at: meeting_at ?? (status === 'meeting' ? lead.meeting_at : null), callback_at,
      attempts: (lead.attempts || 0) + 1, last_call_at: new Date().toISOString(), notes,
      dnc: status === 'not_interested' ? true : lead.dnc,
    }),
  })
  if (status === 'meeting') {
    await sendWhatsApp(`📅 נקבעה פגישת זום!\n${lead.business}${lead.contact_name ? ` (${lead.contact_name})` : ''}\n${fmt(meeting_at!)}\nטלפון: ${lead.phone}\nנקבע ע"י ${agent.name}${note ? `\nהערה: ${note}` : ''}\n\nhttps://al-systems.co.il/dashboard.html#sales`)
  }
  return { ok: true }
}

async function clock(agent: any, dir: string) {
  const open = (await rest(`sales_shifts?agent_id=eq.${agent.id}&ended_at=is.null&select=*`))?.[0]
  if (dir === 'in') {
    if (open) return { ok: true, shift: open }
    const [shift] = await rest('sales_shifts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ agent_id: agent.id }) })
    return { ok: true, shift }
  }
  if (!open) throw new Error('אין משמרת פתוחה')
  const [shift] = await rest(`sales_shifts?id=eq.${open.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ended_at: new Date().toISOString() }) })
  return { ok: true, shift }
}

// ---------- owner ----------
async function authAdmin(path: string, init: RequestInit) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, { ...init, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' } })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.msg || d.message || d.error_description || `auth ${r.status}`)
  return d
}

async function createAgent(b: any) {
  const username = clip(b.username, 30).toLowerCase()
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('שם משתמש: 3-30 אותיות באנגלית, ספרות, נקודה או מקף')
  const name = clip(b.name, 80)
  if (!name) throw new Error('חסר שם הנציג')
  const password = String(b.password || '')
  if (password.length < 8) throw new Error('סיסמה: לפחות 8 תווים')
  const user = await authAdmin('users', { method: 'POST', body: JSON.stringify({ email: `${username}@${AGENT_DOMAIN}`, password, email_confirm: true, user_metadata: { role: 'sales_agent', name } }) })
  try {
    const [agent] = await rest('sales_agents', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: user.id, username, name, phone: clip(b.phone, 30) || null, hourly_rate: Number(b.hourly_rate) >= 0 && b.hourly_rate !== '' ? Number(b.hourly_rate) : 50 }),
    })
    return { ok: true, agent }
  } catch (e) {
    await authAdmin(`users/${user.id}`, { method: 'DELETE' }).catch(() => {})
    throw e
  }
}

async function setPassword(b: any) {
  const agent = (await rest(`sales_agents?id=eq.${Number(b.agent_id)}&select=*`))?.[0]
  if (!agent) throw new Error('נציג לא נמצא')
  if (String(b.password || '').length < 8) throw new Error('סיסמה: לפחות 8 תווים')
  await authAdmin(`users/${agent.user_id}`, { method: 'PUT', body: JSON.stringify({ password: String(b.password) }) })
  return { ok: true }
}

async function assign(b: any) {
  const agentId = b.agent_id ? Number(b.agent_id) : null
  if (agentId && !(await rest(`sales_agents?id=eq.${agentId}&active=eq.true&select=id`))?.[0]) throw new Error('נציג לא פעיל')
  let ids: number[] = Array.isArray(b.lead_ids) ? b.lead_ids.map(Number).filter(Boolean).slice(0, 2000) : []
  if (!ids.length) {
    // N new, unassigned leads from the pool, by industry / city
    const q = ['agent_id=is.null', 'status=eq.new', 'dnc=eq.false', 'select=id', 'order=rating.desc.nullslast,id', `limit=${Math.min(500, Math.max(1, Number(b.count) || 20))}`]
    if (b.industry) q.push(`industry=eq.${encodeURIComponent(String(b.industry))}`)
    if (b.city) q.push(`city=ilike.*${encodeURIComponent(clip(b.city, 60))}*`)
    ids = ((await rest(`sales_leads?${q.join('&')}`)) || []).map((r: any) => r.id)
  }
  if (!ids.length) return { ok: true, assigned: 0 }
  await rest(`sales_leads?id=in.(${ids.join(',')})`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ agent_id: agentId, assigned_at: agentId ? new Date().toISOString() : null }),
  })
  return { ok: true, assigned: ids.length }
}

async function upsertLeads(rows: any[]) {
  if (!rows.length) return 0
  // a phone we already have is skipped (it may be in the middle of calls)
  const res = await rest('sales_leads?on_conflict=phone_norm', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(rows),
  })
  return (res || []).length
}

async function addLeads(b: any) {
  const industry = String(b.industry || '')
  if (!(await rest(`sales_scripts?industry=eq.${encodeURIComponent(industry)}&select=industry`))?.[0]) throw new Error('תחום לא מוכר')
  const seen = new Set<string>(), rows: any[] = []
  for (const r of (Array.isArray(b.rows) ? b.rows : []).slice(0, 2000)) {
    const phone_norm = normPhone(r.phone)
    const business = clip(r.business, 200)
    if (!phone_norm || !business || seen.has(phone_norm)) continue
    seen.add(phone_norm)
    rows.push({ industry, business, phone: clip(r.phone, 30), phone_norm, contact_name: clip(r.contact_name, 120) || null, city: clip(r.city, 80) || null, address: clip(r.address, 300) || null, website: clip(r.website, 500) || null, source: 'import' })
  }
  return { ok: true, received: rows.length, added: await upsertLeads(rows) }
}

// Google Places API (New), Text Search: "רואי חשבון בחולון"
async function importPlaces(b: any) {
  const key = Deno.env.get('GOOGLE_PLACES_KEY')
  if (!key) throw new Error('חסר מפתח Google Places (GOOGLE_PLACES_KEY ב-Supabase)')
  const script = (await rest(`sales_scripts?industry=eq.${encodeURIComponent(String(b.industry || ''))}&select=industry,label`))?.[0]
  if (!script) throw new Error('תחום לא מוכר')
  const city = clip(b.city, 60)
  const query = clip(b.query, 120) || `${script.label} ${city ? 'ב' + city : 'בישראל'}`
  const max = Math.min(60, Math.max(1, Number(b.max) || 60))
  const found: any[] = []
  let pageToken = ''
  for (let page = 0; page < 3 && found.length < max; page++) {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.nationalPhoneNumber,places.internationalPhoneNumber,places.formattedAddress,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.addressComponents,nextPageToken',
      },
      body: JSON.stringify({ textQuery: query, languageCode: 'he', regionCode: 'IL', pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`Google: ${d?.error?.message || r.status}`)
    found.push(...(d.places || []))
    pageToken = d.nextPageToken || ''
    if (!pageToken) break
    await new Promise((res) => setTimeout(res, 1500)) // the next page needs a moment
  }
  const rows: any[] = [], seen = new Set<string>()
  let noPhone = 0, closed = 0
  for (const p of found.slice(0, max)) {
    if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') { closed++; continue }
    const phone = p.nationalPhoneNumber || p.internationalPhoneNumber || ''
    const phone_norm = normPhone(phone)
    if (!phone_norm) { noPhone++; continue }
    if (seen.has(phone_norm)) continue
    seen.add(phone_norm)
    const locality = (p.addressComponents || []).find((c: any) => (c.types || []).includes('locality'))?.longText
    rows.push({
      industry: script.industry, business: clip(p.displayName?.text, 200) || 'עסק', phone: clip(phone, 30), phone_norm,
      city: clip(locality || city, 80) || null, address: clip(p.formattedAddress, 300) || null, website: clip(p.websiteUri, 500) || null,
      rating: typeof p.rating === 'number' ? p.rating : null, reviews: p.userRatingCount ?? null, source: 'google', place_id: clip(p.id, 300),
    })
  }
  const added = await upsertLeads(rows)
  return { ok: true, query, found: found.length, with_phone: rows.length, added, no_phone: noPhone, closed }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  const who = await whoIs(req)
  if (!who) return json({ ok: false, error: 'unauthorized' }, 401)
  const b = await req.json().catch(() => ({}))
  try {
    if (who.email === OWNER_EMAIL) {
      if (b.action === 'create_agent') return json(await createAgent(b))
      if (b.action === 'set_password') return json(await setPassword(b))
      if (b.action === 'assign') return json(await assign(b))
      if (b.action === 'import_places') return json(await importPlaces(b))
      if (b.action === 'add_leads') return json(await addLeads(b))
      return json({ ok: false, error: 'unknown_action' }, 400)
    }
    const agent = (await rest(`sales_agents?user_id=eq.${encodeURIComponent(who.id)}&active=eq.true&select=*`))?.[0]
    if (!agent) return json({ ok: false, error: 'unauthorized' }, 401)
    if (b.action === 'log_call') return json(await logCall(agent, b))
    if (b.action === 'clock') return json(await clock(agent, String(b.dir)))
    return json({ ok: false, error: 'unknown_action' }, 400)
  } catch (e) {
    console.error('sales', b.action, e)
    return json({ ok: false, error: (e as Error).message.slice(0, 300) }, 400)
  }
})
