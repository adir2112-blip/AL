// Shared helpers for the social publisher (social-connect, social-publish).

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
export const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
export const OWNER_EMAIL = 'adir2112@gmail.com'
export const DASH = 'https://al-systems.co.il/dashboard.html'
export const GRAPH = 'https://graph.facebook.com/v27.0'
export const GRAPH_VERSION = 'v27.0'

// Meta app "AL Publisher" (developers.facebook.com). The app id and the
// Facebook Login for Business configuration id are public; the app secret is
// the Supabase secret META_APP_SECRET.
export const META_APP_ID = '1146752647806939'
export const META_CONFIG_ID = '1189993260366413'
export const META_APP_SECRET = Deno.env.get('META_APP_SECRET') || ''
export const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/social-connect`

const WA_BOT_URL = 'https://whatsapp-bot-production-120a.up.railway.app'
const WA_BOT_SECRET = Deno.env.get('WA_BOT_SECRET') || ''
const OWNER_WA = '972509143496'

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
export const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })

const REST_HEADERS = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }

// Minimal PostgREST client with the service role.
export async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...REST_HEADERS, ...(init.headers || {}) } })
  const text = await r.text()
  if (!r.ok) throw new Error(`rest ${path.split('?')[0]} ${r.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}
export const patch = (table: string, filter: string, body: unknown) =>
  rest(`${table}?${filter}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) })

export async function getSetting(key: string): Promise<unknown> {
  const rows = await rest(`site_settings?key=eq.${key}&select=value`)
  return rows?.[0]?.value
}

// The video studio on the owner's computer (social-ingest, and the optimizer
// when social-ingest calls it): header x-ingest-key = STUDIO_INGEST_SECRET.
export function ingestKeyOk(req: Request): boolean {
  const want = Deno.env.get('STUDIO_INGEST_SECRET') || ''
  const got = req.headers.get('x-ingest-key') || ''
  if (want.length < 32 || got.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}

export async function isOwner(req: Request): Promise<boolean> {
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

// A signed, time-limited URL the networks can download the video from.
export async function signedVideoUrl(path: string, seconds = 7200): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/social-videos/${encodeURI(path)}`, {
    method: 'POST',
    headers: REST_HEADERS,
    body: JSON.stringify({ expiresIn: seconds }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.signedURL) throw new Error(`signed url ${r.status}: ${JSON.stringify(d).slice(0, 200)}`)
  return `${SUPABASE_URL}/storage/v1${d.signedURL}`
}

export async function deleteVideo(path: string) {
  await fetch(`${SUPABASE_URL}/storage/v1/object/social-videos`, {
    method: 'DELETE',
    headers: REST_HEADERS,
    body: JSON.stringify({ prefixes: [path] }),
  }).catch(() => {})
}

// Brand from a page / account name.
export function brandOf(name: string): string {
  const n = (name || '').toLowerCase().replace(/[\s._-]/g, '')
  if (n.includes('callio')) return 'callio'
  if (n.includes('stopzkor')) return 'stopzkor'
  if (n.includes('alsystems')) return 'al'
  return 'other'
}

export async function sendWhatsApp(message: string): Promise<boolean> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (WA_BOT_SECRET) headers.Authorization = `Bearer ${WA_BOT_SECRET}`
    const r = await fetch(`${WA_BOT_URL}${WA_BOT_SECRET ? '/api/external-send' : '/api/send'}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone: OWNER_WA, message, source: 'אתר AL - פרסומים' }),
    })
    return r.ok
  } catch {
    return false
  }
}

// Graph API call that throws a readable error.
export async function graph(path: string, params: Record<string, string> = {}, method = 'GET'): Promise<any> {
  const url = new URL(path.startsWith('http') ? path : `${GRAPH}/${path}`)
  let init: RequestInit = { method }
  if (method === 'GET') {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  } else {
    init = { method, body: new URLSearchParams(params) }
  }
  const r = await fetch(url, init)
  const d = await r.json().catch(() => ({}))
  if (!r.ok || d.error) {
    const e = d.error || {}
    const err = new Error(e.error_user_msg || e.message || `HTTP ${r.status}`) as Error & { transient?: boolean }
    err.transient = r.status >= 500 || e.is_transient === true || [1, 2, 4, 17, 32, 341].includes(Number(e.code))
    throw err
  }
  return d
}
