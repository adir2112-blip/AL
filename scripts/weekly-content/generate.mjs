// Weekly content generator for A.L Systems blog.
//
// Two-stage pipeline:
//   1. Topic selection — a small model call picks ONE genuine content gap
//      (or declines) from three candidate sources: Search Console queries
//      we already rank for but poorly, Google autocomplete suggestions for
//      our product categories, and (optionally, if BING_WEBMASTER_API_KEY
//      is set) Bing related keywords.
//   2. Drafting — a second model call writes the full post against that
//      target query, with a mandatory structure (comparison table, FAQ,
//      4-6 bullets, extra sections). Anything under 700 words is discarded
//      — the next scheduled run tries a new topic.
//
// Never touches `main` directly — the GitHub Action that calls this script
// opens a PR against `preview` so a human reviews before anything goes live.

import { google } from "googleapis";
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SITE_URL = "https://al-systems.co.il/";
// The property is verified in Search Console as a domain-level property, so
// the API needs the sc-domain: identifier here, not a URL-prefix string.
const GSC_SITE_URL = "sc-domain:al-systems.co.il";
const TODAY = new Date().toISOString().slice(0, 10);

const MIN_WORDS = 700;
const MAX_PENDING_AUTO_PRS = 2;
const LOW_RANK_MIN_POSITION = 10; // "already shows up, but not on page 1"

// The 6 generic category seeds stay (useful baseline), but after a few months
// their autocomplete results converge on the same handful of topics the site
// already covers in depth — so the model keeps seeing "taken" results and has
// nothing genuinely new to pick from. These additional seeds pair each product
// with a specific industry/role its real customers actually come from (per
// the "למי זה הכי מתאים" sections already written across the blog), so Google
// autocomplete surfaces the actual phrasing those searchers use instead of
// more variations on the generic category terms.
const AUTOCOMPLETE_SEEDS = [
  "סוכן AI לעסק",
  "הקלטת שיחות לעסק",
  "ניתוח שיחות מוקד",
  "סידור עבודה למוקד",
  "מערכת CRM לעסק",
  "אוטומציה לעסק",
  // StopZkor (call recording) — by who actually needs it
  "הקלטת שיחות לסוכן ביטוח",
  "הקלטת שיחות למתווך נדלן",
  "הקלטת שיחות לעורך דין",
  "הקלטת שיחות לעצמאי",
  // Callio (call-center AI analytics) — by who runs the call center
  "ניתוח שיחות למוקד מכירות",
  "בקרת איכות למוקד שירות",
  "ניתוח שיחות לחברת ביטוח",
  "ציון שיחה אוטומטי",
  // ShiftSync (shift scheduling) — by vertical
  "סידור משמרות למסעדה",
  "סידור עבודה לבית קפה",
  "ניהול משמרות לחנות",
  "סידור עבודה לרשת סניפים",
  // CRM — by vertical
  "מערכת CRM למוסך",
  "CRM לעסק קטן",
  "ניהול לקוחות לקליניקה",
];

const PRODUCTS = {
  StopZkor: {
    label: "הקלטת שיחות",
    image: "call-recorder-dashboard.jpg",
    aspect: "2.171",
    linkHtml: `<a href="https://stopzkor.co.il/" target="_blank" rel="noopener">StopZkor</a>`,
    ctaExtra: "",
  },
  Callio: {
    label: "Callio",
    image: "callio-dashboard.jpg",
    aspect: "2.234",
    linkHtml: `<a href="https://callio-ai.com/landing" target="_blank" rel="noopener">Callio</a>`,
    ctaExtra: `\n        <p style="margin-top:16px; font-size:0.88rem;"><a href="https://www.facebook.com/CallioAI" target="_blank" rel="noopener">עקבו אחרי Callio בפייסבוק ←</a></p>`,
  },
  ShiftSync: {
    label: "סידור עבודה",
    image: "shifts-roster-anon.jpg",
    aspect: "1.840",
    linkHtml: `<a href="../systems.html#shifts">ShiftSync</a>`,
    ctaExtra: "",
  },
};

// ---------------------------------------------------------------------
// Circuit breaker — too many posts already waiting on human review.
// ---------------------------------------------------------------------

async function countPendingAutoDraftPRs() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY || "adir2112-blip/AL";
  if (!token) {
    console.warn("No GH token available — skipping the pending-PR circuit breaker.");
    return 0;
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open&base=preview&per_page=50`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      console.warn(`GitHub PR list fetch failed (${res.status}) — skipping the circuit breaker.`);
      return 0;
    }
    const prs = await res.json();
    return prs.filter((pr) => pr.head.ref.startsWith("auto/post-")).length;
  } catch (err) {
    console.warn("Pending-PR check failed — skipping the circuit breaker:", err.message);
    return 0;
  }
}

// ---------------------------------------------------------------------
// Taken topics — existing blog posts AND every other page on the site,
// so the model doesn't compete with a cornerstone landing page.
// ---------------------------------------------------------------------

function readTakenTopics() {
  const blogHtml = fs.readFileSync(path.join(ROOT, "blog.html"), "utf8");

  // A card's headline alone understates what a post covers. Several topic
  // clusters (call recording, call-center AI analytics, shift scheduling)
  // were deliberately consolidated into fewer, broader flagship posts on
  // 2026-10-25 — each one folds in multiple narrower angles as FAQ items
  // instead of each angle having its own thin post. If this function only
  // looked at headlines, the model would see a short "taken" list after a
  // consolidation and could easily re-create one of the exact narrow posts
  // that was just merged away, re-introducing the cannibalization problem
  // the consolidation fixed. So: pull every live card's own FAQ questions
  // (and H2 section headings) too, not just its headline, so the model sees
  // the full surface area each flagship already answers.
  const headlines = [];
  const cardRe = /<a class="blog-card reveal" href="(blog\/[^"]+\.html)">[\s\S]*?<h3>([^<]+)<\/h3>/g;
  let cardMatch;
  while ((cardMatch = cardRe.exec(blogHtml))) {
    const [, href, headline] = cardMatch;
    headlines.push(headline);
    const postPath = path.join(ROOT, href);
    if (!fs.existsSync(postPath)) continue;
    const postHtml = fs.readFileSync(postPath, "utf8");

    const faqBlockMatch = postHtml.match(/"@type":\s*"FAQPage"[\s\S]*?"mainEntity":\s*\[([\s\S]*?)\n\s*\]\s*\}\s*<\/script>/);
    if (faqBlockMatch) {
      const questions = [...faqBlockMatch[1].matchAll(/"name":\s*"((?:[^"\\]|\\.)*)"/g)].map((m) =>
        m[1].replace(/\\"/g, '"')
      );
      for (const q of questions) headlines.push(`${q} (נענה כבר בתוך "${headline}")`);
    }

    const h2s = [...postHtml.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
    for (const h of h2s) headlines.push(`${h} (סעיף קיים בתוך "${headline}")`);
  }

  const sitemapXml = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  const titles = [];
  for (const block of sitemapXml.match(/<url>[\s\S]*?<\/url>/g) || []) {
    const loc = block.match(/<loc>(.*?)<\/loc>/)?.[1];
    if (!loc) continue;
    const rel = loc.replace(SITE_URL, "");
    const filePath = rel === "" ? "index.html" : rel;
    if (filePath.startsWith("blog/")) continue; // already covered by headlines above
    const fp = path.join(ROOT, filePath);
    if (!fs.existsSync(fp)) continue;
    const html = fs.readFileSync(fp, "utf8");
    const raw = html.match(/<title>(.*?)<\/title>/)?.[1] || "";
    const title = (filePath === "index.html" ? raw.split(" | ")[1] : raw.split(" | ")[0] || "").trim();
    if (title) titles.push(title);
  }

  return [...headlines, ...titles];
}

// ---------------------------------------------------------------------
// Source 1: Search Console queries we already show up for, but rank low.
// ---------------------------------------------------------------------

async function fetchLowRankQueries() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.warn("No GOOGLE_SERVICE_ACCOUNT_KEY set — continuing with no Search Console data.");
    return [];
  }
  const credentials = JSON.parse(keyJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  const searchconsole = google.searchconsole({ version: "v1", auth });

  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 90);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const res = await searchconsole.searchanalytics.query({
    siteUrl: GSC_SITE_URL,
    requestBody: {
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions: ["query"],
      rowLimit: 200,
    },
  });
  return (res.data.rows || [])
    .map((r) => ({
      query: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      position: Math.round(r.position * 10) / 10,
    }))
    .filter((q) => q.impressions >= 1 && q.position > LOW_RANK_MIN_POSITION)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 25);
}

// ---------------------------------------------------------------------
// Source 2: Google autocomplete for our product categories.
// ---------------------------------------------------------------------

async function fetchAutocompleteSuggestions() {
  const all = new Set();
  for (const seed of AUTOCOMPLETE_SEEDS) {
    try {
      const url = "https://suggestqueries.google.com/complete/search?client=firefox&hl=he&gl=il&q=" + encodeURIComponent(seed);
      const res = await fetch(url);
      const data = await res.json();
      for (const s of data[1] || []) all.add(s);
    } catch (err) {
      console.warn(`Autocomplete fetch failed for "${seed}":`, err.message);
    }
  }
  return [...all];
}

// ---------------------------------------------------------------------
// Source 3 (optional): Bing related keywords. Low value in Hebrew per
// prior experience on a sibling project — only runs if a key is set.
// ---------------------------------------------------------------------

async function fetchBingRelatedKeywords() {
  const apiKey = process.env.BING_WEBMASTER_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://ssl.bing.com/webmaster/api.svc/json/GetRelatedKeywords?apikey=${encodeURIComponent(apiKey)}&q=${encodeURIComponent("סוכן AI לעסק")}&country=il&language=he`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.d || []).map((r) => r.Keyword).filter(Boolean);
  } catch (err) {
    console.warn("Bing related-keywords fetch failed (non-fatal):", err.message);
    return [];
  }
}

// ---------------------------------------------------------------------
// Stage 1: topic selection.
// ---------------------------------------------------------------------

const TOPIC_TOOL = {
  name: "select_topic",
  description: "Pick exactly one genuine content gap to write about, or decline if nothing on the list is a real potential-customer search.",
  input_schema: {
    type: "object",
    properties: {
      decision: { type: "string", enum: ["pick", "none"] },
      target_query: { type: "string", description: "The exact search phrase this post should target. Required if decision=pick." },
      product: { type: "string", enum: Object.keys(PRODUCTS), description: "Which product this topic best serves. Required if decision=pick." },
      reason: { type: "string", description: "1-2 sentences: why this query (or why none qualify), for a human reviewer." },
    },
    required: ["decision", "reason"],
  },
};

async function selectTopic(lowRankQueries, autocompleteSuggestions, bingKeywords, takenTopics) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const lowRankBlock = lowRankQueries.length
    ? lowRankQueries.map((q) => `- "${q.query}" — ${q.impressions} impressions, position ${q.position} (90 days)`).join("\n")
    : "(none — either no data yet, or nothing ranks outside the top 10)";
  const autocompleteBlock = autocompleteSuggestions.length
    ? autocompleteSuggestions.map((s) => `- "${s}"`).join("\n")
    : "(none returned)";
  const bingBlock = bingKeywords.length ? bingKeywords.map((s) => `- "${s}"`).join("\n") : "(not configured / none returned)";

  const prompt = `אתה בוחר נושא אחד לפוסט בלוג חדש עבור A.L Systems (אדיר לוי, שדרות) — סטודיו שבונה מערכות AI לעסקים. שלושה מוצרים רלוונטיים: StopZkor (הקלטת שיחות לאייפון), Callio (ניתוח שיחות מוקד), ShiftSync (סידור עבודה).

## כללים מחייבים
- רק חיפושים של לקוחות פוטנציאליים אמיתיים. בלי שאלות משפטיות כלליות, בלי חיפושים של אנשים פרטיים (למשל "האם מותר להקליט שיחה" בלי הקשר עסקי), בלי נושאים לא קשורים — גם אם יש הרבה הופעות.
- עדיף להחזיר decision=none מאשר לכתוב על נושא חלש או לא רלוונטי.
- אסור לבחור נושא שכבר מכוסה (ברשימת "נושאים תפוסים" למטה) — גם לא זווית קרובה אליו.

## מקור 1: שאילתות שכבר מופיעות ב-Search Console אבל במיקום נמוך (הזדמנות לשפר דירוג)
${lowRankBlock}

## מקור 2: השלמה אוטומטית של גוגל לביטויי בסיס של לקוחות
${autocompleteBlock}

## מקור 3: מילות מפתח קשורות מ-Bing (אם מוגדר)
${bingBlock}

## נושאים תפוסים (אסור לחזור עליהם או על זווית קרובה)
הרשימה כוללת גם כותרות פוסטים וגם שאלות/סעיפים ספציפיים שכבר נענו בתוך פוסט קיים (מסומנים בסוגריים) — כמה נושאים (הקלטת שיחות, ניתוח שיחות מוקד, סידור עבודה) מאוחדים בכוונה לפוסטים רחבים אחדים במקום פוסט נפרד לכל זווית, כדי למנוע קניבליזציה. אל תציע שאילתה שהתשובה עליה כבר קיימת כסעיף או כשאלה נפוצה באחד הפוסטים, גם אם אין לה כותרת ייעודית משלה.
${takenTopics.map((h) => `- ${h}`).join("\n")}

קרא ל-select_topic. אם יש שאילתה טובה שמייצגת חיפוש אמיתי של לקוח פוטנציאלי ולא תפוסה — decision=pick עם target_query מדויק, product מתאים, ו-reason קצר. אחרת — decision=none עם reason שמסביר למה.`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 512,
    tools: [TOPIC_TOOL],
    tool_choice: { type: "tool", name: "select_topic" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("Claude did not return a topic-selection tool call");
  return toolUse.input;
}

// ---------------------------------------------------------------------
// Stage 2: drafting the full post.
// ---------------------------------------------------------------------

const POST_TOOL = {
  name: "create_blog_post",
  description: "Draft one new Hebrew blog post for the A.L Systems site, targeting a pre-chosen search query.",
  input_schema: {
    type: "object",
    properties: {
      slug: { type: "string", description: "kebab-case, English, URL-safe, no .html extension, not already used" },
      category_hebrew: { type: "string", description: "2-4 word Hebrew category label for the eyebrow, e.g. 'ניהול שיחות'" },
      title_hebrew: { type: "string", description: "The Hebrew headline ONLY - do NOT include 'A.L Systems' or any site name/suffix in this field, the page template adds that automatically. Max 46 characters." },
      meta_description_hebrew: { type: "string", description: "140-160 character Hebrew meta description" },
      intro_paragraph: { type: "string", description: "Opens by directly answering the target search query — no throat-clearing." },
      problem_heading: { type: "string", description: "Starts with 'הבעיה: '" },
      problem_paragraph: { type: "string" },
      solution_heading: { type: "string", description: "Starts with 'הפתרון: '" },
      solution_description: {
        type: "string",
        description: "Completes the sentence 'זו בדיוק הסיבה ש-A.L Systems, בניהולו של אדיר לוי משדרות, בנתה את <Product> - ___:' — describe what the product does for this angle",
      },
      shot_alt_text: { type: "string", description: "Hebrew alt text for the product screenshot, specific to this post's angle" },
      bullets: {
        type: "array",
        minItems: 4,
        maxItems: 6,
        description: "4-6 key points, substantive, not filler",
        items: {
          type: "object",
          properties: { bold: { type: "string" }, text: { type: "string" } },
          required: ["bold", "text"],
        },
      },
      detailed_example: {
        type: "object",
        description: "One concrete, specific walk-through scenario — not generic.",
        properties: {
          heading: { type: "string" },
          paragraph: { type: "string" },
        },
        required: ["heading", "paragraph"],
      },
      extra_sections: {
        type: "array",
        minItems: 2,
        maxItems: 3,
        description: "2-3 additional substantive sections beyond problem/solution/example",
        items: {
          type: "object",
          properties: { heading: { type: "string" }, paragraph: { type: "string" } },
          required: ["heading", "paragraph"],
        },
      },
      comparison_table: {
        type: "object",
        description: "Comparison of doing this manually / a generic tool / A.L Systems' product",
        properties: {
          col1_label: { type: "string", description: "e.g. 'ידנית / בלי מערכת'" },
          col2_label: { type: "string", description: "e.g. 'כלי כללי מהמדף'" },
          col3_label: { type: "string", description: "The product name" },
          rows: {
            type: "array",
            minItems: 3,
            maxItems: 5,
            items: {
              type: "object",
              properties: {
                criterion: { type: "string" },
                col1: { type: "string" },
                col2: { type: "string" },
                col3: { type: "string" },
              },
              required: ["criterion", "col1", "col2", "col3"],
            },
          },
        },
        required: ["col1_label", "col2_label", "col3_label", "rows"],
      },
      faq: {
        type: "array",
        minItems: 4,
        maxItems: 5,
        items: {
          type: "object",
          properties: { question: { type: "string" }, answer: { type: "string" } },
          required: ["question", "answer"],
        },
      },
      impact_paragraph: { type: "string" },
      pull_quote: { type: "string" },
      audience_paragraph: { type: "string" },
    },
    required: [
      "slug", "category_hebrew", "title_hebrew", "meta_description_hebrew",
      "intro_paragraph", "problem_heading", "problem_paragraph", "solution_heading",
      "solution_description", "shot_alt_text", "bullets", "detailed_example",
      "extra_sections", "comparison_table", "faq", "impact_paragraph",
      "pull_quote", "audience_paragraph",
    ],
  },
};

async function draftPost(topic) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prod = PRODUCTS[topic.product];

  const prompt = `אתה כותב פוסט בלוג עבור A.L Systems (אדיר לוי, שדרות), ממוקד בשאילתת החיפוש: "${topic.target_query}".
המוצר הרלוונטי: ${topic.product} (${prod.label}).
למה נבחר הנושא הזה: ${topic.reason}

## מבנה חובה
1. פסקת פתיחה שעונה ישירות על השאילתה, בלי התחלה כללית.
2. הבעיה + הפתרון (עם המוצר).
3. 4-6 בולטים מהותיים.
4. דוגמה מפורטת ומוחשית אחת — תרחיש ספציפי, לא כללי.
5. 2-3 חלקים נוספים מהותיים (עומק אמיתי, לא מילוי).
6. טבלת השוואה: ידנית / כלי כללי / המוצר שלנו.
7. 4-5 שאלות נפוצות עם תשובות מלאות.
8. "מה זה משנה בפועל" + ציטוט מודגש + "למי זה הכי מתאים".

## טון וסגנון
ישיר, מעשי, בעברית טבעית, בלי קלישאות שיווקיות גנריות ("מהפכני", "פורץ דרך" וכו'). בלי נתונים או לקוחות מומצאים — רק מה שנכון למוצר בפועל. אורך כולל: לפחות 900 מילים בעברית על כל השדות המחוברים יחד, אז תן לכל שדה עומק אמיתי ולא משפט אחד קצר.

קרא ל-create_blog_post עם כל השדות.`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 12000,
    tools: [POST_TOOL],
    tool_choice: { type: "tool", name: "create_blog_post" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("Claude did not return a post-drafting tool call");
  return sanitizePost({ ...toolUse.input, product: topic.product });
}

// Defensive cleanup: the model sometimes includes the site suffix in the
// title despite instructions not to, and/or exceeds the length budget.
// Never trust generated text to satisfy length/format constraints on its own.
function sanitizePost(post) {
  const MAX_TITLE = 46; // 60 - " | A.L Systems".length
  let title = post.title_hebrew.trim();
  title = title.replace(/\s*[\|\-–—]\s*A\.?L\.?\s*Systems\s*$/i, "").trim();
  if (title.length > MAX_TITLE) {
    const sepMatch = title.match(/^(.{15,46}?)(?::|-| – )/);
    title = sepMatch ? sepMatch[1].trim() : title.slice(0, MAX_TITLE).replace(/\s+\S*$/, "").trim();
  }
  return { ...post, title_hebrew: title };
}

function escAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function countMainWords(html) {
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  const body = mainMatch ? mainMatch[1] : html;
  const text = body
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length ? text.split(" ").length : 0;
}

function renderPostHtml(post) {
  const prod = PRODUCTS[post.product];
  const titleAttr = escAttr(post.title_hebrew);
  const descAttr = escAttr(post.meta_description_hebrew);
  const altAttr = escAttr(post.shot_alt_text);
  const bulletsHtml = post.bullets
    .map((b) => `          <li><b>${b.bold}</b> - ${b.text}</li>`)
    .join("\n");
  const extraSectionsHtml = post.extra_sections
    .map((s) => `        <h2>${escAttr(s.heading)}</h2>\n        <p>${s.paragraph}</p>\n`)
    .join("\n");
  const table = post.comparison_table;
  const tableRowsHtml = table.rows
    .map(
      (r) => `            <tr>
              <th>${escAttr(r.criterion)}</th>
              <td>${escAttr(r.col1)}</td>
              <td>${escAttr(r.col2)}</td>
              <td class="col-us ok">${escAttr(r.col3)}</td>
            </tr>`
    )
    .join("\n");
  const faqItemsHtml = post.faq
    .map(
      (f) => `        <details class="faq-item">
          <summary>${escAttr(f.question)}
            <span class="faq-icon"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg></span>
          </summary>
          <p class="faq-answer">${f.answer}</p>
        </details>`
    )
    .join("\n");
  const faqJsonLd = post.faq
    .map(
      (f) => `    {
      "@type": "Question",
      "name": "${escAttr(f.question)}",
      "acceptedAnswer": { "@type": "Answer", "text": "${escAttr(f.answer)}" }
    }`
    )
    .join(",\n");

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-KERKL716HL"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('consent', 'default', {
    'analytics_storage': (localStorage.getItem('al_cookie_consent') === 'granted') ? 'granted' : 'denied',
    'ad_storage': 'denied'
  });
  gtag('js', new Date());
  gtag('config', 'G-KERKL716HL');
</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${titleAttr} | A.L Systems</title>
<meta name="description" content="${descAttr}">
<link rel="canonical" href="${SITE_URL}blog/${post.slug}.html">
<meta property="og:type" content="article">
<meta property="og:locale" content="he_IL">
<meta property="og:site_name" content="A.L Systems">
<meta property="og:title" content="${titleAttr}">
<meta property="og:description" content="${descAttr}">
<meta property="og:url" content="${SITE_URL}blog/${post.slug}.html">
<meta property="og:image" content="${SITE_URL}assets/systems/${prod.image}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${titleAttr}">
<meta name="twitter:description" content="${descAttr}">
<meta name="twitter:image" content="${SITE_URL}assets/systems/${prod.image}">
<link rel="icon" href="../assets/logo-mark-transparent.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;500;600;700;900&family=Assistant:wght@400;500;600;700;800&family=Heebo:wght@400;500;600&display=swap">
<link rel="stylesheet" href="../css/style.css?v=4">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "${titleAttr}",
  "datePublished": "${TODAY}",
  "dateModified": "${TODAY}",
  "author": { "@type": "Person", "name": "אדיר" },
  "publisher": {
    "@type": "ProfessionalService",
    "name": "A.L Systems",
    "logo": { "@type": "ImageObject", "url": "${SITE_URL}assets/logo-mark-transparent.png" }
  },
  "mainEntityOfPage": "${SITE_URL}blog/${post.slug}.html",
  "image": "${SITE_URL}assets/systems/${prod.image}",
  "description": "${descAttr}"
}
</script>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
${faqJsonLd}
  ]
}
</script>
</head>
<body>

<header class="site-header">
  <div class="container nav">
    <a href="../index.html" class="brand">
      <img src="../assets/logo-mark-transparent.png" alt="A.L Systems">
      <span class="brand-text">
        <strong>A.L Systems</strong>
        <span>מערכות AI לעסקים</span>
      </span>
    </a>
    <ul class="nav-links">
      <li><a href="../index.html">בית</a></li>
      <li><a href="../systems.html">מערכות</a></li>
      <li><a href="../blog.html" class="active">בלוג</a></li>
      <li><a href="../about.html">אודות</a></li>
      <li><a href="../contact.html">צור קשר</a></li>
    </ul>
    <div class="nav-cta">
      <a class="nav-phone" href="tel:0509143496">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        050-9143496
      </a>
      <a href="../contact.html" class="btn btn-gold">שיחת ייעוץ חינם</a>
    </div>
    <button class="nav-toggle" aria-label="תפריט" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
  </div>
</header>

<main>

  <section class="page-hero">
    <canvas class="hero-canvas" aria-hidden="true"></canvas>
    <div class="container">
      <p class="eyebrow">בלוג · ${post.category_hebrew}</p>
      <h1>${titleAttr}</h1>
      <div class="article-meta"><span>${TODAY}</span><span>·</span><span>זמן קריאה: 5 דקות</span></div>
    </div>
  </section>

  <section>
    <div class="container">
      <div class="article-body reveal">

        <p>${post.intro_paragraph}</p>

        <h2>${post.problem_heading}</h2>
        <p>${post.problem_paragraph}</p>

        <h2>${post.solution_heading}</h2>
        <p>זו בדיוק הסיבה ש-A.L Systems, בניהולו של אדיר לוי משדרות, בנתה את <b>${prod.linkHtml}</b> - ${post.solution_description}:</p>

        <div class="shot-frame" style="margin:28px 0;">
          <div class="shot-bar"><span class="mark">A.L</span><span class="sep"></span><span class="label">${prod.label}</span></div>
          <div class="shot-media" style="aspect-ratio:${prod.aspect}"><img class="shot-img" src="../assets/systems/${prod.image}" alt="${altAttr}" loading="lazy" decoding="async"></div>
        </div>

        <ul>
${bulletsHtml}
        </ul>

        <h2>${escAttr(post.detailed_example.heading)}</h2>
        <p>${post.detailed_example.paragraph}</p>

${extraSectionsHtml}
        <h2>${escAttr(table.col3_label)} מול החלופות</h2>
      </div>
      <div class="compare-card reveal">
        <div class="compare-wrap">
        <table class="compare-table">
          <thead>
            <tr>
              <th>קריטריון</th>
              <th>${escAttr(table.col1_label)}</th>
              <th>${escAttr(table.col2_label)}</th>
              <th class="col-us">${escAttr(table.col3_label)}</th>
            </tr>
          </thead>
          <tbody>
${tableRowsHtml}
          </tbody>
        </table>
        </div>
      </div>
      <div class="article-body reveal">

        <h2>שאלות נפוצות</h2>
      </div>
      <div class="faq-list reveal">
${faqItemsHtml}
      </div>
      <div class="article-body reveal">

        <h2>מה זה משנה בפועל</h2>
        <p>${post.impact_paragraph}</p>

        <blockquote class="pull-quote">${post.pull_quote}</blockquote>

        <h2>למי זה הכי מתאים</h2>
        <p>${post.audience_paragraph}</p>

      </div>

      <div class="article-cta reveal">
        <p>רוצים לראות איך זה עובד אצלכם?</p>
        <a href="../contact.html" class="btn btn-gold">קבעו שיחת ייעוץ חינם</a>${prod.ctaExtra}
      </div>
    </div>
  </section>

</main>

<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div>
        <div class="footer-brand">
          <img src="../assets/logo-mark-transparent.png" alt="A.L">
          <strong>A.L Systems</strong>
        </div>
        <p style="color:rgba(251,248,242,0.65); font-size:0.92rem; max-width:32ch;">מערכות AI מותאמות אישית לעסקים - בנייה מותאמת אישית של כלי עבודה חכמים לעסקים. פועלים משדרות ומשרתים לקוחות בכל הארץ.</p>
      </div>
      <div>
        <h4>ניווט</h4>
        <ul class="footer-links">
          <li><a href="../index.html">בית</a></li>
          <li><a href="../systems.html">מערכות</a></li>
          <li><a href="../ai-agent-for-business.html">סוכן AI לעסק</a></li>
          <li><a href="../blog.html">בלוג</a></li>
          <li><a href="../about.html">אודות</a></li>
          <li><a href="../contact.html">צור קשר</a></li>
        </ul>
      </div>
      <div>
        <h4>יצירת קשר</h4>
        <ul class="footer-links">
          <li><a href="tel:0509143496">050-9143496</a></li>
          <li><a href="mailto:adir2112@gmail.com">adir2112@gmail.com</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© 2026 A.L Systems · כל הזכויות שמורות</span>
      <div class="footer-legal"><a href="../privacy.html">מדיניות פרטיות</a><a href="../terms.html">תנאי שימוש</a></div>
    </div>
  </div>
</footer>

<a class="wa-float" href="https://wa.me/972509143496" target="_blank" rel="noopener" aria-label="שיחה בוואטסאפ">
  <svg viewBox="0 0 24 24"><path d="M17.6 6.32A7.85 7.85 0 0 0 12.05 4c-4.38 0-7.94 3.56-7.94 7.94 0 1.4.37 2.76 1.06 3.96L4 20l4.2-1.1a7.9 7.9 0 0 0 3.85 1h.01c4.38 0 7.94-3.56 7.94-7.94 0-2.12-.83-4.11-2.4-5.64zm-5.55 12.2h-.01a6.6 6.6 0 0 1-3.36-.92l-.24-.14-2.5.65.67-2.44-.16-.25a6.55 6.55 0 0 1-1-3.48c0-3.63 2.96-6.59 6.6-6.59 1.76 0 3.42.69 4.66 1.93a6.55 6.55 0 0 1 1.93 4.67c0 3.63-2.96 6.57-6.59 6.57zm3.6-4.93c-.2-.1-1.17-.58-1.35-.64-.18-.07-.31-.1-.44.1-.13.2-.5.64-.62.77-.11.13-.23.14-.42.05a5.4 5.4 0 0 1-1.6-.99 6 6 0 0 1-1.1-1.37c-.12-.2 0-.3.09-.4.09-.1.2-.24.29-.36.1-.12.13-.2.2-.33.06-.13.03-.25-.02-.35-.05-.1-.44-1.06-.6-1.45-.16-.38-.32-.33-.44-.33h-.38c-.13 0-.34.05-.52.25-.18.2-.68.66-.68 1.62 0 .95.7 1.87.8 2 .1.13 1.37 2.1 3.33 2.94.46.2.83.32 1.11.41.47.15.9.13 1.24.08.38-.06 1.17-.48 1.33-.94.16-.46.16-.86.11-.94-.05-.08-.18-.13-.38-.23z"/></svg>
</a>

<script src="../js/main.js"></script>
<script src="../js/cookie-consent.js" defer></script>
</body>
</html>
`;
}

// Both insert functions below anchor on a single-line marker and splice by
// index, rather than matching a multi-line template containing a literal
// "\n" — a hardcoded multi-line match silently no-ops (writes nothing, throws
// nothing) the moment the target file's line endings don't match the script's
// own, e.g. after any edit that introduces CRLF. That exact failure mode took
// out a real run on 2026-10-29: sitemap.xml had drifted to CRLF, the old
// updateSitemap() match silently failed, the post's sitemap entry was never
// added, and the later `git add assets/og/blog-<slug>.png` (never generated,
// since the OG script reads sitemap.xml to know which posts exist) crashed
// the whole job with nothing committed and no notification sent.
function updateBlogHtml(post) {
  const file = path.join(ROOT, "blog.html");
  let html = fs.readFileSync(file, "utf8");
  const titleAttr = escAttr(post.title_hebrew);
  const descAttr = escAttr(post.meta_description_hebrew);
  const categoryAttr = escAttr(post.category_hebrew);

  const jsonLdMarker = '"blogPost": [';
  const jsonLdIdx = html.indexOf(jsonLdMarker);
  if (jsonLdIdx === -1) throw new Error('updateBlogHtml: "blogPost": [ marker not found in blog.html');
  const jsonLdEntry = `    {
      "@type": "BlogPosting",
      "headline": "${titleAttr}",
      "url": "${SITE_URL}blog/${post.slug}.html",
      "datePublished": "${TODAY}"
    },`;
  const afterMarker = jsonLdIdx + jsonLdMarker.length;
  html = html.slice(0, afterMarker) + "\n" + jsonLdEntry + html.slice(afterMarker);

  const cardMarker = '<a class="blog-card reveal"';
  const cardIdx = html.indexOf(cardMarker);
  const cardEntry = `        <a class="blog-card reveal" href="blog/${post.slug}.html">
          <span class="blog-date">${TODAY} · ${categoryAttr}</span>
          <h3>${titleAttr}</h3>
          <p>${descAttr}</p>
          <span class="blog-read">לקריאה ←</span>
        </a>

`;
  if (cardIdx === -1) {
    // No existing cards (shouldn't normally happen) — fall back to right
    // after the grid div.
    const gridMarker = '<div class="blog-grid">';
    const gridIdx = html.indexOf(gridMarker);
    if (gridIdx === -1) throw new Error('updateBlogHtml: neither an existing card nor <div class="blog-grid"> found in blog.html');
    const afterGrid = gridIdx + gridMarker.length;
    html = html.slice(0, afterGrid) + "\n\n" + cardEntry + html.slice(afterGrid);
  } else {
    html = html.slice(0, cardIdx) + cardEntry + html.slice(cardIdx);
  }

  fs.writeFileSync(file, html);
}

function updateSitemap(post) {
  const file = path.join(ROOT, "sitemap.xml");
  let xml = fs.readFileSync(file, "utf8");
  const entry = `  <url>
    <loc>${SITE_URL}blog/${post.slug}.html</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
`;
  const anchor = "<loc>https://al-systems.co.il/privacy.html</loc>";
  const anchorIdx = xml.indexOf(anchor);
  if (anchorIdx === -1) throw new Error("updateSitemap: privacy.html <loc> anchor not found in sitemap.xml");
  const urlOpenIdx = xml.lastIndexOf("<url>", anchorIdx);
  if (urlOpenIdx === -1) throw new Error("updateSitemap: no enclosing <url> found before the privacy.html anchor");
  xml = xml.slice(0, urlOpenIdx) + entry + xml.slice(urlOpenIdx);
  fs.writeFileSync(file, xml);
}

function writeSummary(obj) {
  fs.writeFileSync(path.join(ROOT, ".weekly-post-summary"), JSON.stringify(obj) + "\n");
}

async function main() {
  const pendingCount = await countPendingAutoDraftPRs();
  if (pendingCount >= MAX_PENDING_AUTO_PRS) {
    const reason = `${pendingCount} auto-draft PR(s) already pending review (limit ${MAX_PENDING_AUTO_PRS}).`;
    console.log(`Skipping: ${reason}`);
    writeSummary({ skip: true, reason });
    return;
  }

  const takenTopics = readTakenTopics();
  const [lowRankQueries, autocompleteSuggestions, bingKeywords] = await Promise.all([
    fetchLowRankQueries(),
    fetchAutocompleteSuggestions(),
    fetchBingRelatedKeywords(),
  ]);

  const topic = await selectTopic(lowRankQueries, autocompleteSuggestions, bingKeywords, takenTopics);
  console.log("Topic decision:", JSON.stringify(topic));

  if (topic.decision !== "pick" || !topic.target_query || !PRODUCTS[topic.product]) {
    const reason = topic.reason || "no topic selected";
    console.log(`Skipping this run: ${reason}`);
    writeSummary({ skip: true, reason });
    return;
  }

  const post = await draftPost(topic);

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(post.slug)) {
    throw new Error(`Rejected unsafe slug from model output: ${JSON.stringify(post.slug)}`);
  }
  const postPath = path.join(ROOT, "blog", `${post.slug}.html`);
  if (fs.existsSync(postPath)) {
    throw new Error(`Slug collision: ${post.slug}.html already exists`);
  }

  const html = renderPostHtml(post);
  const wordCount = countMainWords(html);
  console.log(`Draft word count: ${wordCount} (minimum ${MIN_WORDS})`);
  if (wordCount < MIN_WORDS) {
    const reason = `Draft on "${topic.target_query}" came in at ${wordCount} words, under the ${MIN_WORDS}-word minimum.`;
    console.log(`Skipping this run: ${reason}`);
    writeSummary({ skip: true, reason });
    return;
  }

  fs.writeFileSync(postPath, html);
  updateBlogHtml(post);
  updateSitemap(post);

  // Surface the slug/title/target query/reason to the GitHub Actions step
  // for the PR title/body.
  writeSummary({
    skip: false,
    slug: post.slug,
    title: post.title_hebrew,
    product: post.product,
    targetQuery: topic.target_query,
    reason: topic.reason,
  });
  console.log("Draft created:", post.slug, "-", post.title_hebrew);
}

if (process.env.SKIP_MAIN !== "1") {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { renderPostHtml, countMainWords, sanitizePost };
