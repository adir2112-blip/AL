// "סטודיו AL" in dashboard.html (owner only).
//   {action:"start", kind, prompt, model, web, files:[...], parent_id?,
//    template_id? (decks: follow a saved structure, compare to the last run),
//    brand_id? (decks: a saved client whose colour, logo and photos the deck uses),
//    quote?: {client_id?, rate?, vat?} (doc: a numbered quote for a saved client)}
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
- layouts: cover, dashboard, section (מעבר בין חלקים), bullets, table, stats (2-4 מספרים מרכזיים), two_columns (2-3 קופסאות, למשל "לשימור" מול "לשיפור"), chart, closing.
- dashboard הוא השקף המרכזי במצגת נתונים, כמו דוח BI: באותו שקף 2-3 כרטיסי stats (המספרים החשובים, ב-note השינוי מהתקופה הקודמת, למשל "+74% משנה שעברה" או "-31% מהחודש הקודם"), גרף (chart עם title קצר) וטבלה (table, עד 12 שורות). כשיש נתונים, רוב השקפים הם dashboard.
- chart.type: bar (עמודות), hbar (עמודות אופקיות, טוב לדירוג של שמות ארוכים), line (מגמה לאורך זמן), pie, combo (עמודות וקו אחוזים על ציר שני: סדרות הכמויות as="bar" וסדרת האחוז as="line" עם ערכים כשבר עשרוני, 0.71 = 71%).
- השוואה בין תקופות: כמה series באותו chart, הישנה קודם והחדשה אחרונה (החדשה נצבעת בצבע המותג). ב-table: עמודה לכל תקופה.
- כותרות שקפים של נתונים: מה רואים + התקופה, למשל "ביטולים ושימורים – 11.26". subtitle: משפט קצר שמסביר מה בשקף.
- שקף = רעיון אחד. כותרת עד 8 מילים. עד 6 נקודות בשקף, עד 14 מילים לנקודה.
- נתונים בטבלה: table. headers ושורות באותו מספר עמודות, העמודה הראשונה היא שם השורה. שורת סיכום (סה"כ) אחרונה עם total_row=true. טבלה ארוכה מתפצלת לבד, אל תפצל.
- כשיש מספרים להשוואה לאורך זמן או בין קבוצות, הוסף גם שקף chart או stats. מצגת טובה מערבבת סוגי שקפים ולא רק bullets.
- notes: מה להגיד בעל פה בשקף (משפט או שניים), או ריק.
- שדות שלא שייכים ל-layout: ריקים ("", [], false, ו-chart עם type "bar", title ריק ומערכים ריקים).
- date_label: החודש והשנה של המצגת, או ריק.

מסמך (doc):
- sections לפי הסדר, kind לכל אחד: text (פסקאות), bullets, table, pricing (שורות מחיר וסה"כ), terms (paragraphs[0]=כותרת הקופסה, bullets=התנאים, paragraphs[1]=הערה קטנה), signature (paragraphs[0]=סוג תשלום), callout (הדגשה).
- הצעת מחיר: על ההצעה (text), פירוט העבודה (table עם numbered=true, עמודות סעיף ותיאור), תמחור (pricing), תנאי השירות וזמינות (terms), אישור וחתימה (signature). footer_note: "הצעה תקפה ל-30 יום • תשלום בהעברה בנקאית בלבד" אם לא נאמר אחרת.
- pricing: כל שורה עם quantity (מספר), unit ("שעות", "יח'", "חודשים" וכו'), unit_price (מספר, לפני מע"מ). את הסכומים, המע"מ והסה"כ המערכת מחשבת לבד, אל תכתוב אותם. vat_mode: plus_vat (המחירים לפני מע"מ, ברירת המחדל), included (המחירים כוללים מע"מ), none (פטור).
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
          layout: { type: 'string', enum: ['cover', 'dashboard', 'section', 'bullets', 'table', 'stats', 'two_columns', 'chart', 'closing'] },
          title: STR, subtitle: STR, bullets: STRS, notes: STR,
          table: {
            type: 'object', additionalProperties: false, required: ['title', 'headers', 'rows', 'total_row', 'note'],
            properties: { title: STR, headers: STRS, rows: { type: 'array', items: STRS }, total_row: { type: 'boolean' }, note: STR },
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
            type: 'object', additionalProperties: false, required: ['title', 'type', 'labels', 'series'],
            properties: {
              title: STR,
              type: { type: 'string', enum: ['bar', 'hbar', 'line', 'pie', 'combo'] },
              labels: STRS,
              series: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false, required: ['name', 'values', 'as'],
                  properties: { name: STR, values: { type: 'array', items: { type: 'number' } }, as: { type: 'string', enum: ['bar', 'line'] } },
                },
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
            type: 'object', additionalProperties: false, required: ['rows', 'vat_mode', 'note'],
            properties: {
              rows: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false, required: ['description', 'quantity', 'unit', 'unit_price'],
                  properties: { description: STR, quantity: { type: 'number' }, unit: STR, unit_price: { type: 'number' } },
                },
              },
              vat_mode: { type: 'string', enum: ['plus_vat', 'included', 'none'] },
              note: STR,
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

type Extra = { template?: any; quote?: { no: string; client: any; rate: number; vat: number } | null; brandId?: number | null }

async function runJob(job: any, files: InFile[], parent: any, extra: Extra = {}) {
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
    if (extra.template && !parent) {
      const t = extra.template
      ask += `\n\nתבנית קבועה "${t.name}": בנה את המצגת באותו מבנה בדיוק כמו המבנה המצורף (אותם שקפים, אותו סדר, אותם סוגי שקפים וכותרות), עם הנתונים החדשים מהקבצים ומהבקשה. ` +
        `שקף שאין לו נתונים חדשים: השאר אותו וכתוב [להשלים]. נתונים חדשים שאין להם מקום: הוסף שקף לפני הסיום.\n<structure>\n${JSON.stringify(t.structure).slice(0, 80000)}\n</structure>`
      if (t.last_result) {
        ask += `\n\nאלה הנתונים מהפעם הקודמת. השווה אליהם: בשקפי stats כתוב ב-note את השינוי (למשל "+11.6% לעומת ספטמבר"), ובטבלאות הוסף עמודת שינוי כשזה מועיל.\n<previous>\n${JSON.stringify(t.last_result).slice(0, 80000)}\n</previous>`
      }
    }
    if (extra.quote) {
      const q = extra.quote, c = q.client || {}
      ask += `\n\nזו הצעת מחיר מספר ${q.no}. התעריף לשעה: ${q.rate} ₪ לפני מע"מ (אלא אם אדיר כתב אחרת). מע"מ: ${q.vat}%.` +
        (q.client ? `\nהלקוח: ${c.name}${c.company_no ? `, ח.פ ${c.company_no}` : ''}${c.contact ? `, איש קשר: ${c.contact}` : ''}${c.address ? `, ${c.address}` : ''}${c.notes ? `\nהערות על הלקוח: ${c.notes}` : ''}. to = שם הלקוח.` : '')
    }
    content.push({ type: 'text', text: ask })
    if (job.web || kind === 'research') {
      const notes = await research(run, job.model, content)
      content.push({ type: 'text', text: `<research_notes>\n${notes}\n</research_notes>\nעכשיו כתוב את התוצר הסופי לפי ההערות האלה.` })
    }
    const deck = isDeck(parent?.kind || kind)
    const result = await structured(run, job.model, content, deck ? DECK_SCHEMA : DOC_SCHEMA, deck ? 32000 : 24000)
    result.type = deck ? 'deck' : 'doc'
    if (extra.quote) {
      result.quote_no = extra.quote.no
      result.vat_pct = extra.quote.vat
      if (extra.quote.client?.company_no) result.to_company_no = extra.quote.client.company_no
    } else if (parent?.result?.quote_no) {
      result.quote_no = parent.result.quote_no; result.vat_pct = parent.result.vat_pct; result.to_company_no = parent.result.to_company_no
    }
    if (result.vat_pct == null) result.vat_pct = 18
    const brandId = extra.brandId ?? parent?.result?.brand_id ?? extra.template?.structure?.brand_id ?? null
    if (deck && brandId) result.brand_id = brandId
    // a job the owner cancelled meanwhile stays cancelled
    await patch('studio_jobs', `id=eq.${job.id}&status=eq.running`, {
      status: 'done', result, cost_usd: Math.round(run.cost * 10000) / 10000, duration_s: Math.round((Date.now() - started) / 1000),
    })
    // the template remembers this run, so next month compares to it
    if (extra.template && !parent) await patch('studio_templates', `id=eq.${extra.template.id}`, { last_result: result }).catch(() => {})
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

      const extra: Extra = {}
      if (body.brand_id !== undefined && isDeck(kind)) extra.brandId = body.brand_id ? Number(body.brand_id) : null
      if (body.template_id && isDeck(kind) && !parent) {
        extra.template = (await rest(`studio_templates?id=eq.${Number(body.template_id)}&select=*`))?.[0]
        if (!extra.template) return json({ ok: false, error: 'התבנית לא נמצאה' }, 400)
      }
      let quoteNo: string | null = null, clientId: number | null = null
      if (body.quote && kind === 'doc' && !parent) {
        const st = (await rest('studio_settings?id=eq.1&select=*'))?.[0] || { hourly_rate: 300, vat_pct: 18 }
        const client = body.quote.client_id ? (await rest(`studio_clients?id=eq.${Number(body.quote.client_id)}&select=*`))?.[0] : null
        quoteNo = String(await rest('rpc/studio_next_quote', { method: 'POST', body: '{}' }))
        clientId = client?.id || null
        const rate = Number(body.quote.rate), vat = Number(body.quote.vat)
        extra.quote = {
          no: quoteNo, client,
          rate: rate > 0 ? rate : Number(st.hourly_rate),
          vat: body.quote.vat !== '' && body.quote.vat != null && Number.isFinite(vat) ? vat : Number(st.vat_pct),
        }
      }
      const title = clip(prompt.split('\n')[0] || files.map((f) => f.name).join(', '), 120) || 'משימה'
      const [job] = await rest('studio_jobs', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          kind, title, prompt, model, web: !!body.web || kind === 'research',
          file_names: files.map((f) => clip(f.name, 120)), parent_id: parent?.id || null,
          template_id: extra.template?.id || null, quote_no: quoteNo, client_id: clientId,
        }),
      })
      // @ts-ignore EdgeRuntime is provided by Supabase
      EdgeRuntime.waitUntil(runJob(job, files, parent, extra))
      return json({ ok: true, id: job.id, quote_no: quoteNo })
    }

    return json({ ok: false, error: 'unknown_action' }, 400)
  } catch (e) {
    console.error('studio', e)
    return json({ ok: false, error: (e as Error).message.slice(0, 300) }, 502)
  }
})
