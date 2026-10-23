// Rebuilds rss.xml from the blog cards already in blog.html. No separate
// data source to keep in sync — blog.html is the source of truth, same as
// it already is for sitemap.xml. Safe to re-run anytime.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SITE_URL = "https://al-systems.co.il/";
const MAX_ITEMS = 30;

// Older posts (pre-dating the current auto-generator) display their date as
// "8 באוקטובר 2026" instead of the ISO "2026-10-08" every newer card uses.
const HEBREW_MONTHS = {
  "ינואר": 1, "פברואר": 2, "מרץ": 3, "אפריל": 4, "מאי": 5, "יוני": 6,
  "יולי": 7, "אוגוסט": 8, "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12,
};

function parseCardDate(raw) {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const heb = raw.match(/^(\d{1,2})\s+ב?(\S+)\s+(\d{4})$/);
  if (heb) {
    const month = HEBREW_MONTHS[heb[2]];
    if (month) return `${heb[3]}-${String(month).padStart(2, "0")}-${heb[1].padStart(2, "0")}`;
  }
  return null;
}

function readCards() {
  const html = fs.readFileSync(path.join(ROOT, "blog.html"), "utf8");
  const cardRe = /<a class="blog-card reveal" href="(blog\/[^"]+\.html)">\s*<span class="blog-date">([^<]+?)\s*·[^<]*<\/span>\s*<h3>([^<]+)<\/h3>\s*<p>([^<]+)<\/p>/g;
  const cards = [];
  let m;
  while ((m = cardRe.exec(html))) {
    const date = parseCardDate(m[2].trim());
    if (!date) {
      console.warn(`Could not parse date "${m[2].trim()}" for ${m[1]} — skipping from feed.`);
      continue;
    }
    cards.push({ href: m[1], date, title: m[3], description: m[4] });
  }
  return cards;
}

function toRfc822(dateStr) {
  // Only a date is tracked (no time), so pin every item to a fixed time of
  // day in Israel time — matches how sitemap.xml's lastmod is date-only too.
  return new Date(`${dateStr}T08:00:00+03:00`).toUTCString().replace("GMT", "+0000");
}

function escXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildFeed(cards) {
  const items = cards
    .slice(0, MAX_ITEMS)
    .map((c) => {
      const link = `${SITE_URL}${c.href}`;
      return `    <item>
      <title>${escXml(c.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${toRfc822(c.date)}</pubDate>
      <description><![CDATA[${c.description}]]></description>
    </item>`;
    })
    .join("\n");

  const now = new Date().toUTCString().replace("GMT", "+0000");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>A.L Systems - בלוג</title>
    <link>${SITE_URL}blog.html</link>
    <description>מערכות AI מותאמות אישית לעסקים - מאמרים, מדריכים ועדכונים</description>
    <language>he-il</language>
    <lastBuildDate>${now}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

function main() {
  const cards = readCards().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (cards.length === 0) {
    console.warn("No blog cards found in blog.html — not writing rss.xml.");
    return;
  }
  const xml = buildFeed(cards);
  fs.writeFileSync(path.join(ROOT, "rss.xml"), xml);
  console.log(`rss.xml written with ${Math.min(cards.length, MAX_ITEMS)} items.`);
}

main();
