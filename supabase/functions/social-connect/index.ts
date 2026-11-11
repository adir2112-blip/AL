// Connects the owner's social accounts (Facebook + Instagram, TikTok, YouTube, LinkedIn) to the social publisher.
//  POST {platform:"meta"} with the owner's login token -> { url } of the
//       Facebook login dialog (a one-time "state" guards the callback).
//  GET  ?code&state (the redirect back from Facebook) -> exchanges the code
//       for a long-lived token, saves every Page he manages plus the
//       Instagram business account linked to it, and sends him back to
//       dashboard.html#social.
// Tokens never leave the server: the dashboard can't read the token column.
// Deploy with: supabase functions deploy social-connect --no-verify-jwt
// Requires the META_APP_SECRET secret.

import {
  CORS, DASH, GRAPH_VERSION, META_APP_ID, META_APP_SECRET, META_CONFIG_ID, REDIRECT_URI,
  brandOf, graph, isOwner, json, rest,
} from '../_shared/social.ts'
import { TIKTOK_CLIENT_SECRET, exchangeCode, tiktokAuthUrl, userInfo } from '../_shared/tiktok.ts'
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, exchangeYoutubeCode, youtubeAuthUrl } from '../_shared/youtube.ts'
import { LINKEDIN_CLIENT_SECRET, exchangeLinkedinCode, linkedinAuthUrl } from '../_shared/linkedin.ts'

// YouTube and LinkedIn are Callio's for now; the owner can change the brand
// in the dashboard and a reconnect keeps it.
async function saveAccount(row: Record<string, unknown>, fallbackBrand: string) {
  const existing = await rest(`social_accounts?platform=eq.${row.platform}&external_id=eq.${encodeURIComponent(String(row.external_id))}&select=brand`)
  await rest('social_accounts?on_conflict=platform,external_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ parent_id: null, username: null, status: 'ok', connected_at: new Date().toISOString(), ...row, brand: existing?.[0]?.brand || fallbackBrand }]),
  })
}

async function finishYoutube(code: string): Promise<string> {
  const y = await exchangeYoutubeCode(code)
  await saveAccount({ platform: 'youtube', external_id: y.sub, name: y.name, token: JSON.stringify({ refresh: y.refresh }), token_expires_at: null }, 'callio')
  return y.name
}

async function finishLinkedin(code: string): Promise<string> {
  const l = await exchangeLinkedinCode(code)
  await saveAccount({ platform: 'linkedin', external_id: l.sub, name: l.name, token: JSON.stringify({ access: l.access }), token_expires_at: l.expires_at }, 'callio')
  return l.name
}

// TikTok: one account per login. The brand comes from the display name
// (Callio / StopZkor); the owner can change it in the dashboard.
async function finishTiktok(code: string): Promise<string> {
  const t = await exchangeCode(code)
  const me = await userInfo(t.token.access)
  const existing = await rest(`social_accounts?platform=eq.tiktok&external_id=eq.${encodeURIComponent(t.open_id)}&select=brand`)
  const brand = existing?.[0]?.brand || brandOf(me.display_name)
  await rest('social_accounts?on_conflict=platform,external_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{
      platform: 'tiktok', external_id: t.open_id, name: me.display_name, username: me.display_name, brand,
      token: JSON.stringify(t.token), token_expires_at: t.expires_at, parent_id: null, status: 'ok', connected_at: new Date().toISOString(),
    }]),
  })
  return me.display_name
}

async function newState(platform: string): Promise<string> {
  const state = crypto.randomUUID().replace(/-/g, '')
  await rest('social_oauth_states', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ state, platform }) })
  return state
}

const back = (q: string) => new Response(null, { status: 302, headers: { Location: `${DASH}?${q}#social` } })

async function startMeta(): Promise<string> {
  const state = crypto.randomUUID().replace(/-/g, '')
  await rest('social_oauth_states', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ state, platform: 'meta' }) })
  const u = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`)
  u.searchParams.set('client_id', META_APP_ID)
  u.searchParams.set('redirect_uri', REDIRECT_URI)
  u.searchParams.set('config_id', META_CONFIG_ID)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('override_default_response_type', 'true')
  u.searchParams.set('state', state)
  return u.toString()
}

// One-time state, valid for 15 minutes.
async function takeState(state: string): Promise<string | null> {
  if (!/^[a-f0-9]{32}$/.test(state)) return null
  const rows = await rest(`social_oauth_states?state=eq.${state}&select=platform,created_at`, {
    method: 'DELETE', headers: { Prefer: 'return=representation' },
  })
  const row = rows?.[0]
  if (!row || Date.now() - new Date(row.created_at).getTime() > 15 * 60 * 1000) return null
  return row.platform
}

async function finishMeta(code: string): Promise<{ pages: number; instagram: number; names: string[] }> {
  const short = await graph('oauth/access_token', {
    client_id: META_APP_ID, client_secret: META_APP_SECRET, redirect_uri: REDIRECT_URI, code,
  })
  const long = await graph('oauth/access_token', {
    grant_type: 'fb_exchange_token', client_id: META_APP_ID, client_secret: META_APP_SECRET, fb_exchange_token: short.access_token,
  })
  // Page tokens taken from a long-lived user token don't expire.
  const pages = await graph('me/accounts', {
    access_token: long.access_token,
    fields: 'id,name,access_token,instagram_business_account{id,username,name}',
    limit: '100',
  })
  const rows: Record<string, unknown>[] = []
  const names: string[] = []
  for (const p of pages.data || []) {
    const brand = brandOf(p.name)
    rows.push({ platform: 'facebook', external_id: p.id, name: p.name, username: null, token: p.access_token, brand, parent_id: null, status: 'ok', connected_at: new Date().toISOString(), token_expires_at: null })
    names.push(p.name)
    // Instagram is saved only for brands we publish to (Callio, StopZkor):
    // e.g. the mortgage account linked to the A.L Systems page stays out.
    const ig = p.instagram_business_account
    if (ig?.id && (brand === 'callio' || brand === 'stopzkor')) {
      rows.push({ platform: 'instagram', external_id: ig.id, name: ig.name || p.name, username: ig.username || null, token: p.access_token, brand, parent_id: p.id, status: 'ok', connected_at: new Date().toISOString(), token_expires_at: null })
      names.push('@' + (ig.username || ig.id))
    }
  }
  if (rows.length) {
    // Keep a brand the owner changed by hand: only new rows get the guessed brand.
    const existing = await rest(`social_accounts?select=platform,external_id,brand&platform=in.(facebook,instagram)`)
    const kept = new Map((existing || []).map((e: any) => [`${e.platform}:${e.external_id}`, e.brand]))
    for (const r of rows) {
      const k = `${r.platform}:${r.external_id}`
      if (kept.has(k)) r.brand = kept.get(k)
    }
    await rest('social_accounts?on_conflict=platform,external_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows),
    })
  }
  return {
    pages: rows.filter((r) => r.platform === 'facebook').length,
    instagram: rows.filter((r) => r.platform === 'instagram').length,
    names,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)

  if (req.method === 'POST') {
    if (!(await isOwner(req))) return json({ ok: false, error: 'unauthorized' }, 401)
    const body = await req.json().catch(() => ({}))
    if (body.platform === 'tiktok') {
      if (!TIKTOK_CLIENT_SECRET) return json({ ok: false, error: 'TIKTOK_CLIENT_SECRET חסר ב-Supabase' }, 500)
      return json({ ok: true, url: tiktokAuthUrl(await newState('tiktok')) })
    }
    if (body.platform === 'youtube') {
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return json({ ok: false, error: "GOOGLE_CLIENT_SECRET חסר ב-Supabase" }, 500)
      return json({ ok: true, url: youtubeAuthUrl(await newState('youtube')) })
    }
    if (body.platform === 'linkedin') {
      if (!LINKEDIN_CLIENT_SECRET) return json({ ok: false, error: 'LINKEDIN_CLIENT_SECRET חסר ב-Supabase' }, 500)
      return json({ ok: true, url: linkedinAuthUrl(await newState('linkedin')) })
    }
    if (body.platform !== 'meta') return json({ ok: false, error: 'unknown_platform' }, 400)
    if (!META_APP_SECRET) return json({ ok: false, error: 'META_APP_SECRET חסר ב-Supabase' }, 500)
    return json({ ok: true, url: await startMeta() })
  }

  // GET: the redirect back from the network's login dialog.
  const state = url.searchParams.get('state') || ''
  const platform = await takeState(state).catch(() => null)
  if (!platform) return back('connect_error=' + encodeURIComponent('הקישור פג תוקף. נסה שוב.'))
  if (url.searchParams.get('error')) return back('connect_error=' + encodeURIComponent('החיבור בוטל.'))
  const code = url.searchParams.get('code') || ''
  if (!code) return back('connect_error=' + encodeURIComponent('לא התקבל קוד מהרשת.'))
  if (platform === 'youtube' || platform === 'linkedin') {
    const he = platform === 'youtube' ? 'יוטיוב' : 'לינקדאין'
    try {
      const name = platform === 'youtube' ? await finishYoutube(code) : await finishLinkedin(code)
      return back(`connected=${platform}&name=` + encodeURIComponent(name))
    } catch (e) {
      console.error(platform, 'connect failed', e)
      return back('connect_error=' + encodeURIComponent(`החיבור ל${he} נכשל: ` + (e as Error).message))
    }
  }
  if (platform === 'tiktok') {
    try {
      const name = await finishTiktok(code)
      return back('connected=tiktok&name=' + encodeURIComponent(name))
    } catch (e) {
      console.error('tiktok connect failed', e)
      return back('connect_error=' + encodeURIComponent('החיבור לטיקטוק נכשל: ' + (e as Error).message))
    }
  }
  try {
    const r = await finishMeta(code)
    return back(`connected=meta&pages=${r.pages}&ig=${r.instagram}`)
  } catch (e) {
    console.error('meta connect failed', e)
    return back('connect_error=' + encodeURIComponent('החיבור נכשל: ' + (e as Error).message))
  }
})
