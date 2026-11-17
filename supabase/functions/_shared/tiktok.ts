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
  u.searchParams.set('scope', 'user.info.basic,video.upload,video.publish,video.list')
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

// What the post form must show before a Direct Post (TikTok UX guidelines):
// the account's nickname/avatar, the privacy levels it allows, which
// interactions it has turned off, and the longest video it may post.
export type CreatorInfo = {
  creator_avatar_url?: string; creator_username?: string; creator_nickname?: string
  privacy_level_options: string[]; comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean
  max_video_post_duration_sec?: number
}
export const creatorInfo = (access: string): Promise<CreatorInfo> => api('post/publish/creator_info/query/', access, {})

// The choices the owner made in the post form (social_posts.options.tiktok).
// Nothing is pre-selected for him: the privacy level is required, the
// interactions start off, and commercial content must be declared.
export type TikTokPostOptions = {
  privacy_level?: string; allow_comment?: boolean; allow_duet?: boolean; allow_stitch?: boolean
  brand_organic?: boolean; branded_content?: boolean
  // The cover frame the owner picked (TikTok takes a frame, not an image).
  // Drafts ignore it: he picks the cover in the app.
  cover_ms?: number
}

// Sends the whole file in one chunk (our videos are at most 50MB).
export async function startUpload(access: string, video: ArrayBuffer, caption: string, contentType: string, opts: TikTokPostOptions = {}): Promise<string> {
  const size = video.byteLength
  const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 }
  let data
  if (TIKTOK_DIRECT) {
    const creator = await creatorInfo(access)
    const allowed = creator.privacy_level_options || []
    if (!opts.privacy_level) throw new Error('טיקטוק: לא נבחר מי יכול לצפות בסרטון. בחר פרטיות בטופס ונסה שוב.')
    if (!allowed.includes(opts.privacy_level)) throw new Error('טיקטוק: החשבון לא מאפשר את רמת הפרטיות שנבחרה (' + opts.privacy_level + ').')
    if (opts.branded_content && opts.privacy_level === 'SELF_ONLY') throw new Error('טיקטוק: תוכן ממומן לא יכול להיות פרטי.')
    const post_info = {
      title: caption.slice(0, 2200),
      privacy_level: opts.privacy_level,
      disable_comment: !opts.allow_comment || !!creator.comment_disabled,
      disable_duet: !opts.allow_duet || !!creator.duet_disabled,
      disable_stitch: !opts.allow_stitch || !!creator.stitch_disabled,
      brand_content_toggle: !!opts.branded_content,
      brand_organic_toggle: !!opts.brand_organic,
      ...(typeof opts.cover_ms === 'number' && opts.cover_ms > 0 ? { video_cover_timestamp_ms: Math.round(opts.cover_ms) } : {}),
    }
    data = await api('post/publish/video/init/', access, { post_info, source_info })
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

export type TikTokVideo = {
  id: string; create_time: number; title?: string; share_url?: string
  view_count?: number; like_count?: number; comment_count?: number; share_count?: number
}

// The account's latest videos with their counts (scope video.list).
export async function listVideos(access: string, max = 20): Promise<TikTokVideo[]> {
  const fields = 'id,create_time,title,share_url,view_count,like_count,comment_count,share_count'
  const d = await api(`video/list/?fields=${fields}`, access, { max_count: max })
  return d.videos || []
}
