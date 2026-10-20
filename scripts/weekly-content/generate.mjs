// Weekly content generator for A.L Systems blog.
// Reads Search Console query data, asks Claude to draft one new post for a
// genuine content gap, and writes the post + updates blog.html/sitemap.xml.
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

function readExistingHeadlines() {
  const blogHtml = fs.readFileSync(path.join(ROOT, "blog.html"), "utf8");
  const headlines = [...blogHtml.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
  return headlines;
}

async function fetchSearchConsoleQueries() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.warn("No GOOGLE_SERVICE_ACCOUNT_KEY set — continuing with empty query data.");
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
      rowLimit: 100,
    },
  });
  return (res.data.rows || []).map((r) => ({
    query: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    position: Math.round(r.position * 10) / 10,
  }));
}

const POST_TOOL = {
  name: "create_blog_post",
  description: "Draft one new Hebrew blog post for the A.L Systems site.",
  input_schema: {
    type: "object",
    properties: {
      slug: { type: "string", description: "kebab-case, English, URL-safe, no .html extension, not already used" },
      product: { type: "string", enum: Object.keys(PRODUCTS) },
      category_hebrew: { type: "string", description: "2-4 word Hebrew category label for the eyebrow, e.g. 'ניהול שיחות'" },
      title_hebrew: { type: "string", description: "The Hebrew headline ONLY - do NOT include 'A.L Systems' or any site name/suffix in this field, the page template adds that automatically. Max 46 characters." },
      meta_description_hebrew: { type: "string", description: "140-160 character Hebrew meta description" },
      intro_paragraph: { type: "string" },
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
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          properties: { bold: { type: "string" }, text: { type: "string" } },
          required: ["bold", "text"],
        },
      },
      impact_paragraph: { type: "string" },
      pull_quote: { type: "string" },
      audience_paragraph: { type: "string" },
    },
    required: [
      "slug", "product", "category_hebrew", "title_hebrew", "meta_description_hebrew",
      "intro_paragraph", "problem_heading", "problem_paragraph", "solution_heading",
      "solution_description", "shot_alt_text", "bullets", "impact_paragraph",
      "pull_quote", "audience_paragraph",
    ],
  },
};

async function draftPost(queries, existingHeadlines) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const queryBlock = queries.length
    ? queries.map((q) => `- "${q.query}" — ${q.impressions} impressions, ${q.clicks} clicks, avg position ${q.position}`).join("\n")
    : "(No Search Console data available yet — the site was recently reindexed. Use judgment based on the existing content strategy below.)";

  const prompt = `אתה כותב תוכן עבור הבלוג של A.L Systems (אדיר לוי, שדרות) — סטודיו שבונה מערכות AI לעסקים. שלושה מוצרים רלוונטיים לבלוג:
- StopZkor: אפליקציית הקלטת שיחות חכמה לאייפון
- Callio: מערכת ניתוח שיחות מוקד מבוססת AI
- ShiftSync: מערכת סידור עבודה אוטומטית

שאילתות חיפוש אמיתיות מ-Google Search Console (90 הימים האחרונים):
${queryBlock}

כותרות שכבר קיימות בבלוג (אסור לחזור על זווית דומה):
${existingHeadlines.map((h) => `- ${h}`).join("\n")}

המשימה: בחר זווית אחת חדשה לגמרי (לא קרובה לשום כותרת קיימת), רצוי מבוססת על שאילתה אמיתית עם הופעות אבל בלי פוסט מתאים. כתוב פוסט קצר ומעשי (מבנה: פסקת פתיחה, הבעיה, הפתרון, 3 בולטים, מה זה משנה בפועל, ציטוט מודגש, למי זה מתאים) באותו טון כמו הפוסטים הקיימים — ישיר, מעשי, בלי קלישאות שיווקיות גנריות, בעברית טבעית. קרא ל-create_blog_post עם כל השדות.`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    tools: [POST_TOOL],
    tool_choice: { type: "tool", name: "create_blog_post" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = msg.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("Claude did not return a tool call");
  return sanitizePost(toolUse.input);
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

function renderPostHtml(post) {
  const prod = PRODUCTS[post.product];
  const titleAttr = escAttr(post.title_hebrew);
  const descAttr = escAttr(post.meta_description_hebrew);
  const altAttr = escAttr(post.shot_alt_text);
  const bulletsHtml = post.bullets
    .map((b) => `          <li><b>${b.bold}</b> - ${b.text}</li>`)
    .join("\n");

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
      <div class="article-meta"><span>${TODAY}</span><span>·</span><span>זמן קריאה: 3 דקות</span></div>
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

function updateBlogHtml(post) {
  const file = path.join(ROOT, "blog.html");
  let html = fs.readFileSync(file, "utf8");
  const titleAttr = escAttr(post.title_hebrew);
  const descAttr = escAttr(post.meta_description_hebrew);
  const categoryAttr = escAttr(post.category_hebrew);

  const jsonLdEntry = `    {
      "@type": "BlogPosting",
      "headline": "${titleAttr}",
      "url": "${SITE_URL}blog/${post.slug}.html",
      "datePublished": "${TODAY}"
    },`;
  html = html.replace('"blogPost": [', `"blogPost": [\n${jsonLdEntry}`);

  const cardEntry = `        <a class="blog-card reveal" href="blog/${post.slug}.html">
          <span class="blog-date">${TODAY} · ${categoryAttr}</span>
          <h3>${titleAttr}</h3>
          <p>${descAttr}</p>
          <span class="blog-read">לקריאה ←</span>
        </a>

`;
  html = html.replace('<div class="blog-grid">\n\n', `<div class="blog-grid">\n\n${cardEntry}`);

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
  xml = xml.replace("  <url>\n    <loc>https://al-systems.co.il/privacy.html</loc>", `${entry}  <url>\n    <loc>https://al-systems.co.il/privacy.html</loc>`);
  fs.writeFileSync(file, xml);
}

async function main() {
  const [queries, existingHeadlines] = await Promise.all([
    fetchSearchConsoleQueries(),
    Promise.resolve(readExistingHeadlines()),
  ]);

  const post = await draftPost(queries, existingHeadlines);

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(post.slug)) {
    throw new Error(`Rejected unsafe slug from model output: ${JSON.stringify(post.slug)}`);
  }
  if (!PRODUCTS[post.product]) {
    throw new Error(`Rejected unknown product from model output: ${JSON.stringify(post.product)}`);
  }

  const postPath = path.join(ROOT, "blog", `${post.slug}.html`);
  if (fs.existsSync(postPath)) {
    throw new Error(`Slug collision: ${post.slug}.html already exists`);
  }

  fs.writeFileSync(postPath, renderPostHtml(post));
  updateBlogHtml(post);
  updateSitemap(post);

  // Surface the slug/title to the GitHub Actions step for the PR title/body.
  const safeTitle = post.title_hebrew.replace(/\|/g, "-").replace(/\n/g, " ");
  const summary = `${post.slug}|${safeTitle}|${post.product}`;
  fs.writeFileSync(path.join(ROOT, ".weekly-post-summary"), summary + "\n");
  console.log("Draft created:", summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
