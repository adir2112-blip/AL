// TikTok (Login Kit + Content Posting API) for the social publisher.
// App "AL Publisher" on developers.tiktok.com. The client key is public;
// the client secret is the Supabase secret TIKTOK_CLIENT_SECRET.
//
// Until TikTok audits the app, a direct post can only go to private
// accounts, so by default videos are sent as drafts to the creator's TikTok
// inbox (video.upload): he opens TikTok and taps Post. After the audit, set
// the Supabase secret TIKTOK_DIRECT_POST=1 to publish publicly right away.

import { REDIRECT_URI } from './social.ts'

export const TIKTOK_CLIENT_KEY = Deno.env.get('TIKTOK_CLIENT_KEY') || 'sbawa7x29efzq9atlf'
export const TIKTOK_CLIENT_SECRET = Deno.env.get('TIKTOK_CLIENT_SECRET') || ''
export const TIKTOK_DIRECT = Deno.env.get('TIKTOK_DIRECT_POST') === '1'
const API = 'https://open.tiktokapis.com/v2'

export type TikTokToken = { access: string; refresh: string; refresh_expires_at: string }

export function tiktokAuthUrl(state: string): string {
  const u = new URL('https://www.tiktok.com/v2/auth/authorize/')
  u.searchParams.set('client_key', TIKTOK_CLIENT_KEY)
  u.searchParams.set('scope', 'user.info.basic,video.upload,video.publish')
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('redirect_uri', REDIRECT_URI)
  u.searchParams.set('state', state)
  return u.toString()
}

async function tokenCall(params: Record<string, string>) {
  const r = await fetch(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: TIKTOK_CLIENT_KEY, client_secret: TIKTOK_CLIENT_SECRET, ...params }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || d.error || !d.access_token) throw new Error('טיקטוק: ' + (d.error_description || d.error || r.status))
  return {
    open_id: d.open_id as string,
    token: { access: d.access_token, refresh: d.refresh_token, refresh_expires_at: new Date(Date.now() + d.refresh_expires_in * 1000).toISOString() } as TikTokToken,
    expires_at: new Date(Date.now() + (d.expires_in - 120) * 1000).toISOString(),
  }
}

export const exchangeCode = (code: string) => tokenCall({ code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI })
export const refreshToken = (refresh: string) => tokenCall({ grant_type: 'refresh_token', refresh_token: refresh })

async function api(path: string, access: string, body?: unknown): Promise<any> {
  const r = await fetch(`${API}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const d = await r.json().catch(() => ({}))
  const code = d.error?.code
  if (!r.ok || (code && code !== 'ok')) {
    const err = new Error('טיקטוק: ' + (d.error?.message || code || r.status)) as Error & { transient?: boolean }
    err.transient = r.status >= 500 || r.status === 429 || code === 'rate_limit_exceeded'
    throw err
  }
  return d.data
}

export async function userInfo(access: string): Promise<{ open_id: string; display_name: string }> {
  return (await api('user/info/?fields=open_id,display_name', access)).user
}

// Sends the whole file in one chunk (our videos are at most 50MB).
export async function startUpload(access: string, video: ArrayBuffer, caption: string, contentType: string): Promise<string> {
  const size = video.byteLength
  const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 }
  let data
  if (TIKTOK_DIRECT) {
    const creator = await api('post/publish/creator_info/query/', access, {})
    const options: string[] = creator.privacy_level_options || []
    const privacy_level = options.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : options[0]
    data = await api('post/publish/video/init/', access, { post_info: { title: caption.slice(0, 2200), privacy_level }, source_info })
  } else {
    data = await api('post/publish/inbox/video/init/', access, { source_info })
  }
  const up = await fetch(data.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'Content-Length': String(size), 'Content-Range': `bytes 0-${size - 1}/${size}` },
    body: video,
  })
  if (!up.ok) throw new Error('טיקטוק: ההעלאה נכשלה (' + up.status + ')')
  return data.publish_id
}

// PROCESSING_UPLOAD | PROCESSING_DOWNLOAD | SEND_TO_USER_INBOX | PUBLISH_COMPLETE | FAILED
export async function uploadStatus(access: string, publishId: string): Promise<{ status: string; fail_reason?: string; post_ids?: string[] }> {
  const d = await api('post/publish/status/fetch/', access, { publish_id: publishId })
  return { status: d.status, fail_reason: d.fail_reason, post_ids: d.publicaly_available_post_id || d.publicly_available_post_id }
}
