// Shared lead-attribution helpers for the A.L site functions.
// The browser sends a first-touch record (js/main.js -> window.alAttribution);
// here it is cleaned and turned into one "channel" code used for stats.

export type Attribution = {
  referrer: string
  landing: string
  utm: { source?: string; medium?: string; campaign?: string }
  gclid: boolean
  pages: string[]
  demos: string[]
  first_seen: string | null
}

export const CHANNEL_LABELS: Record<string, string> = {
  google: 'גוגל (חיפוש)',
  google_ads: 'גוגל (מודעה)',
  gbp: 'גוגל לעסק',
  bing: 'Bing',
  ai: 'צ׳אט AI (ChatGPT וכו׳)',
  facebook: 'פייסבוק',
  instagram: 'אינסטגרם',
  linkedin: 'לינקדאין',
  youtube: 'יוטיוב',
  tiktok: 'טיקטוק',
  whatsapp: 'וואטסאפ',
  email: 'מייל',
  campaign: 'קישור קמפיין',
  referral: 'אתר אחר',
  direct: 'ישיר / לא ידוע',
}

const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n)
const cleanPath = (v: unknown) => {
  const s = clip(v, 200)
  return s.startsWith('/') ? s.replace(/[^\w\-./%~]/g, '') : ''
}

export function cleanAttribution(raw: unknown): Attribution | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const utmRaw = (r.utm && typeof r.utm === 'object' ? r.utm : {}) as Record<string, unknown>
  const utm: Attribution['utm'] = {}
  for (const k of ['source', 'medium', 'campaign'] as const) if (utmRaw[k]) utm[k] = clip(utmRaw[k], 80)
  let referrer = clip(r.referrer, 300)
  try { if (referrer) { const u = new URL(referrer); referrer = u.origin + u.pathname } } catch { referrer = '' }
  const list = (v: unknown, n: number, f: (x: unknown) => string) =>
    (Array.isArray(v) ? v : []).slice(-n).map(f).filter(Boolean)
  const firstSeen = clip(r.first_seen, 40)
  return {
    referrer,
    landing: cleanPath(r.landing),
    utm,
    gclid: r.gclid === true,
    pages: list(r.pages, 20, cleanPath),
    demos: list(r.demos, 10, (x) => clip(x, 30).toLowerCase().replace(/[^a-z0-9-]/g, '')),
    first_seen: firstSeen && !isNaN(Date.parse(firstSeen)) ? new Date(firstSeen).toISOString() : null,
  }
}

export function channelOf(a: Attribution | null): string {
  if (!a) return 'direct'
  const src = (a.utm.source || '').toLowerCase()
  const med = (a.utm.medium || '').toLowerCase()
  if (a.gclid || (src === 'google' && /cpc|ppc|paid/.test(med))) return 'google_ads'
  if (src) {
    if (/gbp|gmb|google_business|business_profile/.test(src)) return 'gbp'
    if (/^(fb|facebook)/.test(src)) return 'facebook'
    if (/^(ig|instagram)/.test(src)) return 'instagram'
    if (/linkedin/.test(src)) return 'linkedin'
    if (/whatsapp|^wa$/.test(src)) return 'whatsapp'
    if (/tiktok/.test(src)) return 'tiktok'
    if (/youtube|^yt$/.test(src)) return 'youtube'
    if (/mail|newsletter/.test(src) || med === 'email') return 'email'
    if (/chatgpt|openai|perplexity|gemini|copilot/.test(src)) return 'ai'
    return 'campaign'
  }
  let host = ''
  try { host = a.referrer ? new URL(a.referrer).hostname.toLowerCase() : '' } catch { host = '' }
  if (!host) return 'direct'
  if (/(^|\.)google\./.test(host)) return 'google'
  if (/(^|\.)bing\.com$|duckduckgo|yahoo\./.test(host)) return 'bing'
  if (/chatgpt\.com|openai\.com|perplexity\.ai|gemini\.google|copilot\.microsoft|claude\.ai/.test(host)) return 'ai'
  if (/facebook\.com|fb\.com|fb\.me/.test(host)) return 'facebook'
  if (/instagram\.com/.test(host)) return 'instagram'
  if (/linkedin\.com|lnkd\.in/.test(host)) return 'linkedin'
  if (/youtube\.com|youtu\.be/.test(host)) return 'youtube'
  if (/tiktok\.com/.test(host)) return 'tiktok'
  if (/whatsapp\.com|wa\.me/.test(host)) return 'whatsapp'
  if (/mail\./.test(host)) return 'email'
  return 'referral'
}

// One Hebrew line for the email / WhatsApp alert.
export function describe(a: Attribution | null, channel: string, demoNames: Record<string, string>): string {
  const parts = [CHANNEL_LABELS[channel] || channel]
  if (channel === 'referral' && a?.referrer) { try { parts[0] += ' (' + new URL(a.referrer).hostname + ')' } catch { /* ignore */ } }
  if (a?.utm.campaign) parts.push('קמפיין: ' + a.utm.campaign)
  if (a?.landing) parts.push('נכנס ב-' + a.landing)
  if (a?.demos.length) parts.push('עבר בדמו: ' + a.demos.map((d) => (demoNames[d] || d).split(' — ')[0]).join(', '))
  if (a?.pages.length) parts.push(a.pages.length + ' עמודים')
  return parts.join(' · ')
}
