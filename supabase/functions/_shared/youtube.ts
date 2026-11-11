// YouTube (Data API v3) for the social publisher.
// OAuth "Web application" client in the owner's Google Cloud project
// 145349330848 (the same project as the video studio, so one Google audit
// covers both). The client id is public; the secret is the Supabase secret
// GOOGLE_CLIENT_SECRET.
//
// Until Google audits the project, every video uploaded through the API is
// locked as private. After the audit set the Supabase secret YOUTUBE_AUDITED=1
// so the dashboard stops showing the "private until audit" note.

import { REDIRECT_URI } from './social.ts'

export const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || ''
export const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''
export const YOUTUBE_AUDITED = Deno.env.get('YOUTUBE_AUDITED') === '1'
const SCOPE = 'openid profile https://www.googleapis.com/auth/youtube.upload'

export function youtubeAuthUrl(state: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.searchParams.set('client_id', GOOGLE_CLIENT_ID)
  u.searchParams.set('redirect_uri', REDIRECT_URI)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', SCOPE)
  u.searchParams.set('access_type', 'offline')
  u.searchParams.set('prompt', 'consent')
  u.searchParams.set('state', state)
  return u.toString()
}

async function tokenCall(params: Record<string, string>) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, ...params }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.access_token) {
    const err = new Error('יוטיוב: ' + (d.error_description || d.error || r.status)) as Error & { transient?: boolean; revoked?: boolean }
    err.transient = r.status >= 500
    err.revoked = d.error === 'invalid_grant'
    throw err
  }
  return d
}

// The id_token comes straight from Google's token endpoint over TLS, so its
// payload is read without verifying the signature.
function idClaims(idToken?: string): { sub?: string; name?: string } {
  try {
    const p = (idToken || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p), (c) => c.charCodeAt(0))))
  } catch {
    return {}
  }
}

export async function exchangeYoutubeCode(code: string) {
  const d = await tokenCall({ code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI })
  if (!d.refresh_token) throw new Error('יוטיוב: לא התקבל refresh token. נסה לחבר שוב.')
  const c = idClaims(d.id_token)
  return { sub: c.sub || 'youtube', name: c.name || 'YouTube', refresh: d.refresh_token as string }
}

export async function youtubeAccess(refresh: string): Promise<string> {
  return (await tokenCall({ refresh_token: refresh, grant_type: 'refresh_token' })).access_token
}

// Title = first line of the caption (no hashtags/mentions), up to 100 chars.
// YouTube rejects "<" and ">" in titles and descriptions.
export function youtubeMeta(caption: string) {
  const clean = (s: string) => s.replace(/[<>]/g, '')
  const lines = caption.split('\n').map((l) => l.trim()).filter(Boolean)
  const first = (lines[0] || 'סרטון חדש').replace(/[#@][^\s#@]+/g, '').replace(/\s+/g, ' ').trim()
  const title = clean(first || 'סרטון חדש').slice(0, 100)
  const tags: string[] = []
  let len = 0
  for (const m of caption.matchAll(/#([^\s#@]+)/g)) {
    const t = m[1].replace(/[<>,]/g, '')
    if (!t || tags.includes(t) || len + t.length + 1 > 450) continue
    tags.push(t); len += t.length + 1
  }
  return { title, description: clean(caption).slice(0, 5000), tags }
}

// Resumable upload in one PUT (our videos are at most 50MB).
export async function uploadYoutube(access: string, video: ArrayBuffer, caption: string, contentType: string) {
  const { title, description, tags } = youtubeMeta(caption)
  const meta = {
    snippet: { title, description, tags, categoryId: '28', defaultLanguage: 'he', defaultAudioLanguage: 'he' },
    status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
  }
  const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`, 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': contentType, 'X-Upload-Content-Length': String(video.byteLength),
    },
    body: JSON.stringify(meta),
  })
  if (!start.ok) {
    const t = await start.text()
    const err = new Error('יוטיוב: ' + (t.match(/"message":\s*"([^"]+)"/)?.[1] || start.status)) as Error & { transient?: boolean }
    err.transient = start.status >= 500
    throw err
  }
  const put = await fetch(start.headers.get('location')!, { method: 'PUT', headers: { 'Content-Type': contentType }, body: video })
  const d = await put.json().catch(() => ({}))
  if (!put.ok || !d.id) {
    const err = new Error('יוטיוב: ההעלאה נכשלה (' + (d.error?.message || put.status) + ')') as Error & { transient?: boolean }
    err.transient = put.status >= 500
    throw err
  }
  return { id: d.id as string, channelId: (d.snippet?.channelId || '') as string, privacy: (d.status?.privacyStatus || '') as string }
}

// Views and likes from the channel's public feed (no extra API scope needed).
// Only public videos appear there, newest 15.
export async function channelFeedStats(channelId: string): Promise<Map<string, { views: number | null; likes: number | null }>> {
  const out = new Map<string, { views: number | null; likes: number | null }>()
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`)
  if (!r.ok) return out
  const xml = await r.text()
  for (const entry of xml.split('<entry>').slice(1)) {
    const id = entry.match(/<yt:videoId>([^<]+)</)?.[1]
    if (!id) continue
    const views = entry.match(/<media:statistics views="(\d+)"/)?.[1]
    const likes = entry.match(/<media:starRating count="(\d+)"/)?.[1]
    out.set(id, { views: views ? Number(views) : null, likes: likes ? Number(likes) : null })
  }
  return out
}
