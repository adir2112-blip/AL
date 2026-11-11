// LinkedIn for the social publisher: posts on the owner's personal profile
// through his LinkedIn app "Callio Studio" (products "Share on LinkedIn" +
// "Sign In with LinkedIn using OpenID Connect"). The client id is public;
// the secret is the Supabase secret LINKEDIN_CLIENT_SECRET.
// Self-serve apps get no refresh token: the token lasts 60 days and is
// renewed by connecting again (the dashboard shows the expiry date).
// LinkedIn gives no view counts for member posts.

import { REDIRECT_URI } from './social.ts'

export const LINKEDIN_CLIENT_ID = Deno.env.get('LINKEDIN_CLIENT_ID') || '77gbhvz6dt917f'
export const LINKEDIN_CLIENT_SECRET = Deno.env.get('LINKEDIN_CLIENT_SECRET') || ''
const VERSION = '202610'

export function linkedinAuthUrl(state: string): string {
  const u = new URL('https://www.linkedin.com/oauth/v2/authorization')
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', LINKEDIN_CLIENT_ID)
  u.searchParams.set('redirect_uri', REDIRECT_URI)
  u.searchParams.set('scope', 'openid profile w_member_social')
  u.searchParams.set('state', state)
  return u.toString()
}

export async function exchangeLinkedinCode(code: string) {
  const r = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, client_id: LINKEDIN_CLIENT_ID, client_secret: LINKEDIN_CLIENT_SECRET, redirect_uri: REDIRECT_URI,
    }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok || !d.access_token) throw new Error('לינקדאין: ' + (d.error_description || d.error || r.status))
  const me = await (await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${d.access_token}` } })).json().catch(() => ({}))
  if (!me.sub) throw new Error('לינקדאין: לא התקבלו פרטי הפרופיל')
  return {
    sub: me.sub as string,
    name: (me.name || 'LinkedIn') as string,
    access: d.access_token as string,
    expires_at: new Date(Date.now() + (d.expires_in || 5184000) * 1000).toISOString(),
  }
}

async function api(url: string, access: string, body: unknown): Promise<Response> {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`, 'LinkedIn-Version': VERSION, 'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const t = await r.text()
    const err = new Error(`לינקדאין ${r.status}: ${t.slice(0, 200)}`) as Error & { transient?: boolean }
    err.transient = r.status >= 500 || r.status === 429
    throw err
  }
  return r
}

// Post text is LinkedIn "little text": these characters must be escaped or the post is cut.
const littleText = (s: string) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`)

// Upload in the parts LinkedIn asks for, then publish a post with the video.
export async function postLinkedinVideo(access: string, sub: string, video: ArrayBuffer, caption: string) {
  const owner = `urn:li:person:${sub}`
  const bytes = new Uint8Array(video)
  const init = await (await api('https://api.linkedin.com/rest/videos?action=initializeUpload', access, {
    initializeUploadRequest: { owner, fileSizeBytes: bytes.length, uploadCaptions: false, uploadThumbnail: false },
  })).json()
  const { video: urn, uploadInstructions, uploadToken } = init.value
  const etags: string[] = []
  for (const part of uploadInstructions) {
    const up = await fetch(part.uploadUrl, {
      method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes.subarray(part.firstByte, part.lastByte + 1),
    })
    if (!up.ok) throw new Error('לינקדאין: העלאת הסרטון נכשלה (' + up.status + ')')
    etags.push(up.headers.get('etag') || '')
  }
  await api('https://api.linkedin.com/rest/videos?action=finalizeUpload', access, {
    finalizeUploadRequest: { video: urn, uploadToken: uploadToken ?? '', uploadedPartIds: etags },
  })
  const title = (caption.split('\n').find((l) => l.trim()) || '').trim().slice(0, 200)
  const post = await api('https://api.linkedin.com/rest/posts', access, {
    author: owner,
    commentary: littleText(caption),
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { media: { title, id: urn } },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  })
  const id = post.headers.get('x-restli-id') || ''
  return { id, permalink: id ? `https://www.linkedin.com/feed/update/${id}` : null }
}
