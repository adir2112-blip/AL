// "סטודיו AL" in dashboard.html (owner only).
//   {action:"start", kind, prompt, model, web, files:[...], parent_id?}
//     -> {ok, id}. The job runs in the background (EdgeRuntime.waitUntil) and
//        the dashboard polls studio_jobs until status is done / error.
//   {action:"cancel", id}
// Claude writes only the CONTENT, as JSON in one of two shapes:
//   deck (deck_new / deck_upgrade / deck_editable) and doc (everything else).
// The design is fixed in js/studio-render.js, so every file looks the same.
// Files arrive from the browser as images, PDFs (base64) or plain text
// (PowerPoint / Word text is extracted in the browser).
// With web=true (and always for research) Claude first searches the web,
// then writes the result from its notes.
// A daily spend cap (STUDIO_DAILY_USD, default 15) stops runaway costs.
// Requires ANTHROPIC_API_KEY. Deploy with: supabase functions deploy studio --no-verify-jwt

import Anthropic from 'npm:@anthropic-ai/sdk@1.7.0'
import { CORS, isOwner, json, patch, rest } from '../_shared/social.ts'

const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') || '' })
const DAILY_USD = Number(Deno.env.get('STUDIO_DAILY_USD') || 15)

const MODELS: Record<string, { id: string; inUsd: number; outUsd: number }> = {
  opus: { id: 'claude-opus-5-5', inUsd: 4, outUsd: 20 },
  fable: { id: 'claude-fable-5-2', inUsd: 10, outUsd: 50 },
  sonnet: { id: 'claude-sonnet-5-5', inUsd: 2, outUsd: 10 },
}
const KINDS = ['deck_new', 'deck_upgrade', 'deck_editable', 'doc', 'analyze', 'research', 'free'] as const
type Kind = typeof KINDS[number]
const isDeck = (k: string) => k.startsWith('deck_')

const AL_FACTS = `A.L Systems (al-systems.co.il), בבעלות אדיר לוי: בונה לעסקים מערכות עבודה בהתאמה אישית וסוכני AI: CRM, סידור עבודה (משמרות), ניהול מסמכים והתראות, בוט וואטסאפ, אוטומציות, ייעוץ פיננסי. מוצרים: Callio (ניתוח שיחות מכירה ושירות ב-AI למנהלים), StopZkor (אפליקציה שמקליטה, מתמללת ומסכמת שיחות).`

const SYSTEM = `אתה הסטודיו של A.L Systems. אדיר לוי מבקש ממך מצגות, מסמכים, ניתוחים ומחקרים, ואתה כותב את התוכן בלבד, כ-JSON. העיצוב (צבעים, לוגו, פונטים) קבוע ונעשה אחר כך, אז אל תכתוב שום הוראות עיצוב.

${AL_FACTS}

כללים לכל משימה:
- עברית מקצועית, ברורה וקצרה, כמו של יועץ עסקי מנוסה. בלי ניסוחים של AI ("בעולם של היום", "מהפכה", "לא רק... אלא גם"), בלי מקפים ארוכים בתוך משפטים, בלי אימוג'י.
- נתונים: רק מה שיש בקבצים, בבקשה או בחיפוש. אסור להמציא מספרים, שמות, מחירים או לקוחות. אם חסר נתון שצריך, כתוב [להשלים].
- מספרים: עם מפריד אלפים (2,027), אחוזים עם % (11.6%), שקלים עם ₪ אחרי המספר (900 ₪).
- summary: 1-2 משפטים לאדיר על מה הכנת ומה כדאי שיבדוק (למשל איפה כתבת [להשלים]).

מצגת (deck):
- slides לפי הסדר. הראשונה layout=cover, האחרונה closing (title "תודה", subtitle קצר כמו "שאלות והערות").
- layouts: cover, section (מעבר בין חלקים), bullets, table, stats (2-4 מספרים מרכזיים), two_columns (2-3 קופסאות, למשל "לשימור" מול "לשיפור"), chart (bar/line/pie עם מספרים אמיתיים), closing.
- שקף = רעיון אחד. כותרת עד 7 מילים. עד 6 נקודות בשקף, עד 14 מילים לנקודה.
- נתונים בטבלה: table. headers ושורות באותו מספר עמודות, העמודה הראשונה היא שם השורה. שורת סיכום (סה"כ) אחרונה עם total_row=true. טבלה ארוכה מתפצלת לבד, אל תפצל.
- כשיש מספרים להשוואה לאורך זמן או בין קבוצות, הוסף גם שקף chart או stats. מצגת טובה מערבבת סוגי שקפים ולא רק bullets.
- notes: מה להגיד בעל פה בשקף (משפט או שניים), או ריק.
- שדות שלא שייכים ל-layout: ריקים ("", [], false, ו-chart עם type "bar" ומערכים ריקים).
- date_label: החודש והשנה של המצגת, או ריק.

מסמך (doc):
- sections לפי הסדר, kind לכל אחד: text (פסקאות), bullets, table, pricing (שורות מחיר וסה"כ), terms (paragraphs[0]=כותרת הקופסה, bullets=התנאים, paragraphs[1]=הערה קטנה), signature (paragraphs[0]=סוג תשלום), callout (הדגשה).
- הצעת מחיר: על ההצעה (text), פירוט העבודה (table עם numbered=true, עמודות סעיף ותיאור), תמחור (pricing), תנאי השירות וזמינות (terms), אישור וחתימה (signature). footer_note: "הצעה תקפה ל-30 יום • תשלום בהעברה בנקאית בלבד" אם לא נאמר אחרת.
- דוח, ניתוח או מחקר: תקציר מנהלים (callout) בהתחלה, אחר כך חלקים עם כותרות, טבלאות כשיש נתונים, ובסוף "המלצות" (bullets). מחקר: כל כתובת שהשתמשת בה ב-sources.
- to ו-date רק במסמך שנשלח למישהו (הצעה, מכתב). date בפורמט 19.11.2026.
- שדות שלא שייכים ל-kind: ריקים.`

const TASK: Record<Kind, string> = {
  deck_new: 'בנה מצגת חדשה לפי הבקשה והקבצים.',
  deck_upgrade: 'זו מצגת קיימת (הטקסט שלה מצורף, שקף אחרי שקף). בנה אותה מחדש כמצגת מקצועית: שמור על כל הנתונים והמספרים בדיוק, סדר את המבנה, חדד ניסוחים, העבר נתונים לטבלאות וגרפים ואחד או פצל שקפים כשצריך. אל תשמיט מידע.',
  deck_editable: 'הקבצים הם תמונות או PDF של מצגת או מסמך. העתק את כל התוכן בדיוק (טקסט, טבלאות ומספרים) למצגת שאפשר לערוך, שקף מול שקף ככל האפשר. טבלה בתמונה = שקף table. אל תשנה נתונים.',
  doc: 'כתוב את המסמך לפי הבקשה (הצעת מחיר, דוח, מכתב, הצעה וכו\').',
  analyze: 'נתח את הקבצים: מה יש בהם, ממצאים עיקריים, מספרים חשובים, בעיות ותובנות, והמלצות. כתוב כדוח (doc).',
  research: 'חקור את הנושא וכתוב דוח מחקר מסודר (doc) עם ממצאים, נתונים, השוואות והמלצות, וכל המקורות ב-sources.',
  free: 'בצע את המשימה. התוצאה היא מסמך (doc) מסודר.',
}

// ---------- JSON schemas (all fields required; unused ones come back empty) ----------
const STR = { type: 'string' }
const STRS = { type: 'array', items: STR }
const DECK_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'subtitle', 'date_label', 'slides', 'summary'],
  properties: {
    title: STR, subtitle: STR, date_label: STR, summary: STR,
    slides: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['layout', 'title', 'subtitle', 'bullets', 'table', 'stats', 'columns', 'chart', 'notes'],
        properties: {
          layout: { type: 'string', enum: ['cover', 'section', 'bullets', 'table', 'stats', 'two_columns', 'chart', 'closing'] },
          title: STR, subtitle: STR, bullets: STRS, notes: STR,
          table: {
            type: 'object', additionalProperties: false, required: ['headers', 'rows', 'total_row', 'note'],
            properties: { headers: STRS, rows: { type: 'array', items: STRS }, total_row: { type: 'boolean' }, note: STR },
          },
          stats: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, required: ['value', 'label', 'note'], properties: { value: STR, label: STR, note: STR } },
          },
          columns: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, required: ['heading', 'bullets'], properties: { heading: STR, bullets: STRS } },
          },
          chart: {
            type: 'object', additionalProperties: false, required: ['type', 'labels', 'series'],
            properties: {
              type: { type: 'string', enum: ['bar', 'line', 'pie'] },
              labels: STRS,
              series: {
                type: 'array',
                items: { type: 'object', additionalProperties: false, required: ['name', 'values'], properties: { name: STR, values: { type: 'array', items: { type: 'number' } } } },
              },
            },
          },
        },
      },
    },
  },
}
const DOC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'subtitle', 'to', 'date', 'sections', 'sources', 'footer_note', 'summary'],
  properties: {
    title: STR, subtitle: STR, to: STR, date: STR, sources: STRS, footer_note: STR, summary: STR,
    sections: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['heading', 'kind', 'paragraphs', 'bullets', 'table', 'pricing'],
        properties: {
          heading: STR,
          kind: { type: 'string', enum: ['text', 'bullets', 'table', 'pricing', 'terms', 'signature', 'callout'] },
          paragraphs: STRS, bullets: STRS,
          table: {
            type: 'object', additionalProperties: false, required: ['numbered', 'headers', 'rows'],
            properties: { numbered: { type: 'boolean' }, headers: STRS, rows: { type: 'array', items: STRS } },
          },
          pricing: {
            type: 'object', additionalProperties: false, required: ['rows', 'total', 'note'],
            properties: {
              rows: {
                type: 'array',
                items: { type: 'object', additionalProperties: false, required: ['description', 'quantity', 'rate', 'total'], properties: { description: STR, quantity: STR, rate: STR, total: STR } },
              },
              total: STR, note: STR,
            },
          },
        },
      },
    },
  },
}

// ---------- input ----------
type InFile = { name: string; type: string; data?: string; text?: string }
const IMG = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const clip = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n)

function fileBlocks(files: InFile[]): any[] {
  const out: any[] = []
  for (const f of files) {
    const name = clip(f.name, 120).replace(/[<>"]/g, '')
    if (f.text != null) {
      out.push({ type: 'text', text: `<file name="${name}">\n${clip(f.text, 120000)}\n</file>` })
    } else if (f.data && IMG.includes(f.type)) {
      out.push({ type: 'text', text: `קובץ: ${name}` })
      out.push({ type: 'image', source: { type: 'base64', media_type: f.type, data: f.data } })
    } else if (f.data && f.type === 'application/pdf') {
      out.push({ type: 'document', title: name, source: { type: 'base64', media_type: 'application/pdf', data: f.data } })
    }
  }
  return out
}

function today(): string {
  return new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.')
}

// ---------- Claude ----------
type Run = { cost: number }
function addCost(run: Run, model: string, usage: any) {
  const m = MODELS[model]
  if (!usage) return
  const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1
  run.cost += (inTok * m.inUsd + (usage.output_tokens || 0) * m.outUsd) / 1e6
  run.cost += (usage.server_tool_use?.web_search_requests || 0) * 0.01
}

// Web research: free text notes with sources, before the structured answer.
async function research(run: Run, model: string, content: any[]): Promise<string> {
  const messages: any[] = [{
    role: 'user',
    content: [...content, { type: 'text', text: 'חפש באינטרנט את המידע שצריך למשימה הזו. כתוב סיכום עובדתי מפורט בעברית: ממצאים, מספרים ותאריכים, ולכל עובדה את כתובת המקור. אל תכתוב עדיין את התוצר הסופי.' }],
  }]
  for (let round = 0; round < 4; round++) {
    const msg = await client.messages.stream({
      model: MODELS[model].id,
      max_tokens: 16000,
      system: SYSTEM,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 } as any],
      messages,
    } as any).finalMessage()
    addCost(run, model, msg.usage)
    if (msg.stop_reason === 'refusal') throw new Error('הבקשה נדחתה')
    if (msg.stop_reason !== 'pause_turn') {
      return msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
    }
    messages.push({ role: 'assistant', content: msg.content })
  }
  throw new Error('החיפוש לקח יותר מדי זמן')
}

async function structured(run: Run, model: string, content: any[], schema: unknown, maxTokens: number): Promise<any> {
  const msg = await client.beta.messages.stream({
    model: MODELS[model].id,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  } as any).finalMessage()
  addCost(run, model, msg.usage)
  if (msg.stop_reason === 'refusal') throw new Error('הבקשה נדחתה')
  if (msg.stop_reason === 'max_tokens') throw new Error('התוצר יצא ארוך מדי. נסה לבקש פחות שקפים או לפצל את המשימה')
  return JSON.parse(msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''))
}

// Jobs this worker is running. If Supabase stops the worker (time limit),
// they are marked as failed instead of staying "running" forever.
const active = new Set<number>()
addEventListener('beforeunload', () => {
  for (const id of active) {
    patch('studio_jobs', `id=eq.${id}&status=eq.running`, { status: 'error', error: 'המשימה נעצרה כי לקחה יותר מדי זמן. נסה לבקש תוצר קצר יותר, או לפצל אותה.' }).catch(() => {})
  }
})

async function runJob(job: any, files: InFile[], parent: any) {
  active.add(job.id)
  const started = Date.now()
  const run: Run = { cost: 0 }
  try {
    const kind = job.kind as Kind
    const content: any[] = [...fileBlocks(files)]
    let ask = `היום: ${today()}\nהמשימה: ${TASK[kind]}\n\nהבקשה של אדיר:\n${job.prompt || '(בלי הוראות נוספות)'}`
    if (parent?.result) {
      ask = `היום: ${today()}\nזו תוצאה שהכנת קודם (JSON):\n${JSON.stringify(parent.result).slice(0, 150000)}\n\n` +
        `אדיר מבקש לשפר אותה כך:\n${job.prompt}\n\nהחזר את כל התוצר המעודכן (לא רק את השינויים), באותו מבנה.`
    }
    content.push({ type: 'text', text: ask })
    if (job.web || kind === 'research') {
      const notes = await research(run, job.model, content)
      content.push({ type: 'text', text: `<research_notes>\n${notes}\n</research_notes>\nעכשיו כתוב את התוצר הסופי לפי ההערות האלה.` })
    }
    const deck = isDeck(parent?.kind || kind)
    const result = await structured(run, job.model, content, deck ? DECK_SCHEMA : DOC_SCHEMA, deck ? 32000 : 24000)
    result.type = deck ? 'deck' : 'doc'
    // a job the owner cancelled meanwhile stays cancelled
    await patch('studio_jobs', `id=eq.${job.id}&status=eq.running`, {
      status: 'done', result, cost_usd: Math.round(run.cost * 10000) / 10000, duration_s: Math.round((Date.now() - started) / 1000),
    })
  } catch (e) {
    console.error('studio job', job.id, e)
    await patch('studio_jobs', `id=eq.${job.id}&status=eq.running`, {
      status: 'error', error: clip((e as Error).message, 900), cost_usd: Math.round(run.cost * 10000) / 10000,
      duration_s: Math.round((Date.now() - started) / 1000),
    }).catch(() => {})
  } finally {
    active.delete(job.id)
  }
}

async function spentToday(): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const rows = await rest(`studio_jobs?created_at=gte.${since}&select=cost_usd`)
  return (rows || []).reduce((n: number, r: any) => n + Number(r.cost_usd || 0), 0)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ ok: false, error: 'ANTHROPIC_API_KEY חסר ב-Supabase' }, 500)
  if (!(await isOwner(req))) return json({ ok: false, error: 'unauthorized' }, 401)
  const body = await req.json().catch(() => ({}))

  try {
    if (body.action === 'cancel') {
      await patch('studio_jobs', `id=eq.${Number(body.id)}&status=eq.running`, { status: 'cancelled' })
      return json({ ok: true })
    }

    if (body.action === 'start') {
      let parent: any = null
      if (body.parent_id) {
        parent = (await rest(`studio_jobs?id=eq.${Number(body.parent_id)}&select=*`))?.[0]
        if (!parent?.result) return json({ ok: false, error: 'אין תוצאה קודמת לשפר' }, 400)
      }
      const kind = (parent ? parent.kind : body.kind) as Kind
      if (!KINDS.includes(kind)) return json({ ok: false, error: 'סוג משימה לא מוכר' }, 400)
      const model = MODELS[body.model] ? body.model : 'opus'
      const prompt = clip(body.prompt, 20000)
      const files: InFile[] = (Array.isArray(body.files) ? body.files : []).slice(0, 20)
      if (!prompt && !files.length) return json({ ok: false, error: 'כתוב מה להכין או צרף קובץ' }, 400)
      if (parent && !prompt) return json({ ok: false, error: 'כתוב מה לשפר' }, 400)

      const spent = await spentToday()
      if (spent >= DAILY_USD) return json({ ok: false, error: `הגעת לתקרה היומית של הסטודיו ($${DAILY_USD}). אפשר להמשיך מחר, או להעלות את STUDIO_DAILY_USD.` }, 429)

      const title = clip(prompt.split('\n')[0] || files.map((f) => f.name).join(', '), 120) || 'משימה'
      const [job] = await rest('studio_jobs', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          kind, title, prompt, model, web: !!body.web || kind === 'research',
          file_names: files.map((f) => clip(f.name, 120)), parent_id: parent?.id || null,
        }),
      })
      // @ts-ignore EdgeRuntime is provided by Supabase
      EdgeRuntime.waitUntil(runJob(job, files, parent))
      return json({ ok: true, id: job.id })
    }

    return json({ ok: false, error: 'unknown_action' }, 400)
  } catch (e) {
    console.error('studio', e)
    return json({ ok: false, error: (e as Error).message.slice(0, 300) }, 502)
  }
})
