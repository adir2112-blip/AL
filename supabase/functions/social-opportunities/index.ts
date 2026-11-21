// "הזדמנויות" in dashboard.html: finds public posts where one of our brands
// can genuinely help, and drafts a reply the owner posts HIMSELF.
// This function never talks to Facebook. Posts reach it two ways:
//   {action:"email", emails:[{id, subject, body}]}  from the Apps Script in
//     the owner's Gmail (tools/gmail-opportunities.gs), which forwards
//     Facebook notification emails. Header x-opps-key = OPPS_INGEST_SECRET.
//   {action:"analyze", text, url?, place?}  pasted in the dashboard (owner).
// {action:"redraft", id, instruction?}  rewrites one draft (owner).
// Claude reads each post, picks the brand that fits (or none), scores the fit
// 0-10 and drafts a reply. Posts scoring MIN_RELEVANCE or more are stored in
// social_opportunities; new ones from email are announced on WhatsApp.
// Requires ANTHROPIC_API_KEY. Deploy with: supabase functions deploy social-opportunities --no-verify-jwt

import Anthropic from 'npm:@anthropic-ai/sdk@1.7.0'
import { CORS, isOwner, json, patch, rest, sendWhatsApp } from '../_shared/social.ts'

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '' })
const MIN_RELEVANCE = 6
const DASH_LINK = 'https://al-systems.co.il/dashboard.html#opps'

// Facts only: a draft may not claim anything that is not here.
const BRANDS: Record<string, string> = {
  callio: `Callio (callio-ai.com): מערכת AI שמנתחת שיחות טלפון של עסקים (מכירות ושירות) בשביל מנהלים.
מתמללת את השיחות, נותנת ציון ותובנות לכל שיחה, ומראה למנהל מה קורה בשיחות של העובדים (למשל נציג שהבטיח ללקוח משהו ולא קיים).
מתאים ל: בעלי עסקים ומנהלים עם צוות מכירות, מוקד שירות או מוקד טלפוני, שרוצים לדעת מה קורה בשיחות בלי להקשיב לכולן.`,
  stopzkor: `StopZkor (stopzkor.co.il): אפליקציה שמקליטה שיחות טלפון, מתמללת ומסכמת אותן בעברית, ומזכירה כל הבטחה שנתת בשיחה (למשל לשלוח הצעת מחיר).
המידע נשמר אצל המשתמש במכשיר. לאייפון ולאנדרואיד. באנדרואיד יש 60 דקות ניסיון חינם.
מתאים ל: עצמאים, אנשי מכירות ובעלי עסקים קטנים שמדברים הרבה בטלפון, שוכחים מה סוכם, או מחפשים דרך להקליט שיחות.
בטלפון בלי הקלטה מובנית (למשל סמסונג שיובא מחו"ל) StopZkor עובדת יחד עם האפליקציה Cube ACR, אחרי שמפעילים לה את הנגישות בהגדרות. אנחנו עוזרים בהתקנה לפי הדגם. על סמסונג כבר התקנו ללקוח וזה עבד, אבל לא מבטיחים לגבי כל דגם.`,
  al: `A.L Systems (al-systems.co.il): בונה לעסקים מערכות עבודה בהתאמה אישית וסוכני AI: CRM, סידור עבודה (משמרות), ניהול מסמכים והתראות, בוט וואטסאפ, אוטומציות.
יש הדגמה חיה בחינם ושיחת ייעוץ ללא עלות.
מתאים ל: עסקים שמנהלים דברים באקסל/בוואטסאפ/בניירת ומחפשים מערכת או אוטומציה, או שואלים על סוכן AI לעסק.`,
}

const SYSTEM = `אתה עוזר לאדיר לוי, המייסד של A.L Systems, למצוא פוסטים ברשתות שבהם אחד המוצרים שלו באמת עוזר, ולנסח לו תגובה. אדיר קורא כל טיוטה, עורך ומפרסם בעצמו מהפרופיל שלו.

המוצרים:
${Object.entries(BRANDS).map(([k, v]) => `[${k}]\n${v}`).join('\n\n')}

לכל פוסט:
1. brand: המוצר שהכי עוזר לכותב הפוסט, או none.
2. relevance 0-10: כמה התגובה תעזור לכותב באמת.
   9-10: הוא מבקש בדיוק את מה שהמוצר עושה ("מחפש אפליקציה להקלטת שיחות", "איך יודעים מה הנציגים אומרים ללקוחות").
   6-8: יש לו בעיה שהמוצר פותר, גם אם לא ביקש כלי.
   0-5: קשור רק מרחוק, או שזה פרסומת, מודעת דרושים, מתחרה שמפרסם את עצמו, פוליטיקה, או פוסט שתגובה מסחרית בו תיראה לא במקום. במקרים האלה brand=none.
3. why: משפט אחד, למה כן או למה לא.
4. draft: התגובה, בגוף ראשון כאדיר.

כללי התגובה:
- קודם כל לעזור: לענות על מה שהוא שאל, עם עצה מעשית אחת או שתיים שעוזרות גם בלי המוצר.
- המוצר במשפט אחד טבעי, ובשקיפות: "אנחנו פיתחנו..." / "יש לנו מערכת בדיוק לזה...". אף פעם לא להתחזות ללקוח מרוצה או לאדם שלא קשור.
- בלי קישורים. אם צריך, שם המוצר בלבד (אפשר "תחפשו Callio בגוגל" או "תשלח לי הודעה פרטית").
- קצר: 2-4 משפטים. עברית ישראלית מדוברת ופשוטה, כמו חבר שעונה בקבוצה: "מכיר את זה, מבאס", "מה שעובד אצלנו זה...", "תכתוב לי בפרטי". משפטים קצרים, מילים יומיומיות, בלי מילים גבוהות ובלי שפה של משרד או של פרסומת. מתאים לטון של הפוסט.
- בלי ניסוחים של AI ("בעולם של היום", "מהפכה", "לא רק... אלא גם", "בהחלט", "אשמח לעזור!", "גילוי נאות", "בהצלחה רבה!"), בלי מקפים ארוכים (—), בלי האשטגים, לכל היותר אימוג'י אחד. את השקיפות לגבי המוצר להגיד בפשטות: "ובשקיפות, אנחנו פיתחנו...".
- לא להמציא מחירים, נתונים, לקוחות או יכולות שלא כתובים למעלה.
- גם כש-brand=none, לכתוב ב-draft תגובה קצרה ועוזרת בלי שום מוצר (או "-" אם אין מה לכתוב).`

const POST_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['post_text', 'post_url', 'place', 'author', 'brand', 'relevance', 'why', 'draft'],
  properties: {
    post_text: { type: 'string', description: 'The post text as written (without email headers/footers).' },
    post_url: { type: 'string', description: 'Link to the post if present, else empty string.' },
    place: { type: 'string', description: 'Group or page name if known, else empty string.' },
    author: { type: 'string', description: 'Who wrote the post if known, else empty string.' },
    brand: { type: 'string', enum: ['callio', 'stopzkor', 'al', 'none'] },
    relevance: { type: 'integer' },
    why: { type: 'string' },
    draft: { type: 'string' },
  },
}
const SCHEMA = { type: 'object', additionalProperties: false, required: ['posts'], properties: { posts: { type: 'array', items: POST_ITEM } } }
const DRAFT_SCHEMA = { type: 'object', additionalProperties: false, required: ['draft'], properties: { draft: { type: 'string' } } }

type Post = { post_text: string; post_url: string; place: string; author: string; brand: string; relevance: number; why: string; draft: string }

async function ask(user: string, schema: unknown, maxTokens = 6000): Promise<any> {
  const msg = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  } as any)
  if (msg.stop_reason === 'refusal') throw new Error('הבקשה נדחתה')
  return JSON.parse(msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''))
}

const clip = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n)
const safeUrl = (u: string) => (/^https:\/\/[^\s"'<>]+$/.test(u) ? u.slice(0, 2000) : null)

async function dedupeKey(text: string): Promise<string> {
  const norm = text.replace(/\s+/g, ' ').trim().slice(0, 400)
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm)))
  return Array.from(h.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')
}

// Stores the posts that fit a brand; returns the rows that were new.
async function store(posts: Post[], source: 'manual' | 'email'): Promise<any[]> {
  const rows = []
  for (const p of posts) {
    const text = clip(p.post_text, 6000)
    const relevance = Math.max(0, Math.min(10, Math.round(Number(p.relevance) || 0)))
    if (!text || !BRANDS[p.brand] || relevance < MIN_RELEVANCE || !clip(p.draft, 3000)) continue
    rows.push({
      source,
      dedupe: await dedupeKey(text),
      brand: p.brand,
      relevance,
      why: clip(p.why, 600) || null,
      place: clip(p.place, 200) || null,
      author: clip(p.author, 120) || null,
      post_text: text,
      post_url: safeUrl(clip(p.post_url, 2000)),
      draft: clip(p.draft, 3000),
    })
  }
  if (!rows.length) return []
  // a post we already have (same text) is skipped, so a draft the owner
  // edited is never overwritten
  return (await rest('social_opportunities?on_conflict=dedupe', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(rows),
  })) || []
}

function opsKeyOk(req: Request): boolean {
  const want = Deno.env.get('OPPS_INGEST_SECRET') || ''
  const got = req.headers.get('x-opps-key') || ''
  if (want.length < 32 || got.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}

const BRAND_HE: Record<string, string> = { callio: 'Callio', stopzkor: 'StopZkor', al: 'A.L Systems' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ ok: false, error: 'ANTHROPIC_API_KEY חסר ב-Supabase' }, 500)
  const body = await req.json().catch(() => ({}))

  try {
    // ---- from Gmail (Apps Script) ----
    if (body.action === 'email') {
      if (!opsKeyOk(req)) return json({ ok: false, error: 'unauthorized' }, 401)
      const emails = (Array.isArray(body.emails) ? body.emails : []).slice(0, 5)
      const found = await Promise.all(emails.map(async (m: any) => {
        const text = `${clip(m.subject, 300)}\n\n${clip(m.body, 8000)}`
        if (text.trim().length < 20) return []
        try {
          const out = await ask(
            'זה מייל התראה מפייסבוק (או רשת אחרת). הוא יכול להכיל פוסט אחד, כמה פוסטים, או אף פוסט (למשל התראה על לייק או בקשת חברות). ' +
            'חלץ כל פוסט שמישהו כתב, עם הקישור אליו אם יש, ושפוט כל אחד. בלי פוסטים: posts ריק.\n\n<email>\n' + text + '\n</email>',
            SCHEMA, 8000)
          return Array.isArray(out.posts) ? out.posts : []
        } catch (e) {
          console.error('social-opportunities email', m.id, e)
          return []
        }
      }))
      const added = await store(found.flat(), 'email')
      // what arrived and how it scored, kept so a quiet feed can be told apart from
      // "emails arrive but nothing passes MIN_RELEVANCE" (site_settings opps_ingest_log, last 30)
      try {
        const posts = found.flat() as Post[]
        const entry = {
          at: new Date().toISOString(), emails: emails.length, posts: posts.length, added: added.length,
          scores: posts.map((p) => Math.round(Number(p.relevance) || 0)).sort((x, y) => y - x).slice(0, 8),
          subjects: emails.map((m: any) => clip(m.subject, 70)),
        }
        const prev = (await rest('site_settings?key=eq.opps_ingest_log&select=value'))?.[0]?.value
        const log = [entry, ...(Array.isArray(prev) ? prev : [])].slice(0, 30)
        await rest('site_settings?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ key: 'opps_ingest_log', value: log }) })
      } catch (e) { console.error('opps ingest log', e) }
      if (added.length) {
        const top = added.sort((a, b) => b.relevance - a.relevance).slice(0, 3)
        await sendWhatsApp(
          `💬 ${added.length === 1 ? 'הזדמנות חדשה לתגובה' : `${added.length} הזדמנויות חדשות לתגובה`}\n` +
          top.map((r) => `• ${BRAND_HE[r.brand]} (${r.relevance}/10)${r.place ? ` · ${r.place}` : ''}: ${r.post_text.slice(0, 80).replace(/\s+/g, ' ')}...`).join('\n') +
          `\n\nטיוטות מוכנות: ${DASH_LINK}`)
      }
      return json({ ok: true, emails: emails.length, posts: found.flat().length, added: added.length })
    }

    if (!(await isOwner(req))) return json({ ok: false, error: 'unauthorized' }, 401)

    // ---- pasted in the dashboard ----
    if (body.action === 'analyze') {
      const text = clip(body.text, 6000)
      if (text.length < 10) return json({ ok: false, error: 'הדבק את הטקסט של הפוסט' }, 400)
      const url = safeUrl(clip(body.url, 2000)) || ''
      const place = clip(body.place, 200)
      const out = await ask(
        'שפוט את הפוסט הזה (posts עם פריט אחד בדיוק).\n' + (place ? `איפה: ${place}\n` : '') + '\n<post>\n' + text + '\n</post>', SCHEMA)
      const p: Post = { ...(out.posts?.[0] || {}), post_text: text, post_url: url, place: place || out.posts?.[0]?.place || '' }
      const added = await store([p], 'manual')
      const fits = !!BRANDS[p.brand] && Number(p.relevance) >= MIN_RELEVANCE
      return json({ ok: true, stored: added.length > 0, duplicate: fits && !added.length, brand: p.brand, relevance: p.relevance, why: p.why, draft: p.draft, row: added[0] || null })
    }

    // ---- rewrite one draft ----
    if (body.action === 'redraft') {
      const id = Number(body.id)
      const row = (await rest(`social_opportunities?id=eq.${id}&select=*`))?.[0]
      if (!row) return json({ ok: false, error: 'not_found' }, 404)
      const instruction = clip(body.instruction, 500)
      const out = await ask(
        `המוצר: ${row.brand}\n${row.place ? `איפה: ${row.place}\n` : ''}\n<post>\n${row.post_text}\n</post>\n\n` +
        `הטיוטה הנוכחית:\n${row.draft}\n\n` +
        (instruction ? `מה אדיר ביקש לשנות: ${instruction}\n` : 'כתוב גרסה אחרת, טבעית יותר.\n') +
        'החזר רק את התגובה החדשה ב-draft.', DRAFT_SCHEMA, 3000)
      const draft = clip(out.draft, 3000)
      if (!draft) throw new Error('לא התקבלה טיוטה')
      await patch('social_opportunities', `id=eq.${id}`, { draft })
      return json({ ok: true, draft })
    }

    return json({ ok: false, error: 'unknown_action' }, 400)
  } catch (e) {
    console.error('social-opportunities', e)
    return json({ ok: false, error: (e as Error).message.slice(0, 300) }, 502)
  }
})
