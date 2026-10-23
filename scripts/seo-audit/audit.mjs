// Read-only SEO audit (Stage 1 of the SEO upgrade plan): no files are
// written, no pages are changed. Prints a Markdown report to stdout.
//
// Checks, using only locally-tracked site pages + Search Console data:
//   1. Competing pages  - queries where 2+ of our own pages show up
//   2. Thin content     - word count per page/post, shortest first
//   3. Duplicate content - near-identical pages (shingled word overlap)
//   4. Never shown       - pages 6+ weeks old with zero impressions
//   5. Impressions by page - all pages, most to least seen

import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SITE_URL = "https://al-systems.co.il/";
const GSC_SITE_URL = "sc-domain:al-systems.co.il";
const WINDOW_DAYS = 90;
const THIN_WORDS = 400;
const STALE_WEEKS = 6;
const SHINGLE_SIZE = 8;
const DUP_THRESHOLD = 0.3;

function readSitemapEntries() {
  const xml = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  const entries = [];
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];
  for (const block of urlBlocks) {
    const loc = block.match(/<loc>(.*?)<\/loc>/)?.[1];
    const lastmod = block.match(/<lastmod>(.*?)<\/lastmod>/)?.[1];
    if (!loc) continue;
    const rel = loc.replace(SITE_URL, "") || "index.html";
    const filePath = rel === "" || rel === "/" ? "index.html" : rel;
    entries.push({ url: loc, lastmod, filePath });
  }
  return entries;
}

function htmlToWords(html) {
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/);
  const body = mainMatch ? mainMatch[1] : html;
  const noScripts = body.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");
  const text = noScripts
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length ? text.split(" ") : [];
}

function shingles(words, size) {
  const set = new Set();
  const normalized = words.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
  for (let i = 0; i + size <= normalized.length; i++) {
    set.add(normalized.slice(i, i + size).join(" "));
  }
  return set;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

function loadPages() {
  const entries = readSitemapEntries();
  const pages = [];
  for (const e of entries) {
    const fp = path.join(ROOT, e.filePath);
    if (!fs.existsSync(fp)) {
      console.warn(`# WARNING: sitemap entry has no local file: ${e.filePath}`);
      continue;
    }
    const html = fs.readFileSync(fp, "utf8");
    const words = htmlToWords(html);
    pages.push({ ...e, words, wordCount: words.length, shingles: shingles(words, SHINGLE_SIZE) });
  }
  return pages;
}

async function fetchGSC() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.warn("No GOOGLE_SERVICE_ACCOUNT_KEY set — skipping Search Console checks.");
    return null;
  }
  const credentials = JSON.parse(keyJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  const searchconsole = google.searchconsole({ version: "v1", auth });
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - WINDOW_DAYS);
  const fmt = (d) => d.toISOString().slice(0, 10);

  const [queryPage, byPage] = await Promise.all([
    searchconsole.searchanalytics.query({
      siteUrl: GSC_SITE_URL,
      requestBody: {
        startDate: fmt(start),
        endDate: fmt(end),
        dimensions: ["query", "page"],
        rowLimit: 25000,
      },
    }),
    searchconsole.searchanalytics.query({
      siteUrl: GSC_SITE_URL,
      requestBody: {
        startDate: fmt(start),
        endDate: fmt(end),
        dimensions: ["page"],
        rowLimit: 25000,
      },
    }),
  ]);

  return {
    queryPageRows: queryPage.data.rows || [],
    byPageRows: byPage.data.rows || [],
  };
}

function findCompetingPages(queryPageRows) {
  const byQuery = new Map();
  for (const r of queryPageRows) {
    const [query, page] = r.keys;
    if (!r.impressions) continue;
    if (!byQuery.has(query)) byQuery.set(query, new Map());
    byQuery.get(query).set(page, (byQuery.get(query).get(page) || 0) + r.impressions);
  }

  const competingQueries = [];
  const pairCounts = new Map();
  for (const [query, pageMap] of byQuery) {
    if (pageMap.size < 2) continue;
    const pages = [...pageMap.entries()].sort((a, b) => b[1] - a[1]);
    competingQueries.push({ query, pages });
    for (let i = 0; i < pages.length; i++) {
      for (let j = i + 1; j < pages.length; j++) {
        const key = [pages[i][0], pages[j][0]].sort().join(" ↔ ");
        const entry = pairCounts.get(key) || { count: 0, impressions: 0 };
        entry.count++;
        entry.impressions += pages[i][1] + pages[j][1];
        pairCounts.set(key, entry);
      }
    }
  }
  competingQueries.sort((a, b) => b.pages.reduce((s, p) => s + p[1], 0) - a.pages.reduce((s, p) => s + p[1], 0));
  const topPairs = [...pairCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].impressions - a[1].impressions)
    .slice(0, 20);

  return { competingQueries, topPairs };
}

function weeksAgo(dateStr) {
  const then = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - then) / (7 * 24 * 60 * 60 * 1000));
}

function buildReport(pages, gsc) {
  const lines = [];
  lines.push(`# SEO Audit — ${new Date().toISOString().slice(0, 10)} (${WINDOW_DAYS}-day window)`);
  lines.push("");

  // 2. Thin content
  lines.push("## Word count per page (shortest first)");
  const sorted = [...pages].sort((a, b) => a.wordCount - b.wordCount);
  for (const p of sorted) {
    const flag = p.wordCount < THIN_WORDS ? " ⚠️ THIN" : "";
    lines.push(`- ${p.wordCount}w — ${p.filePath}${flag}`);
  }
  lines.push("");

  // 3. Duplicate content
  lines.push(`## Near-duplicate pages (shingle overlap ≥ ${DUP_THRESHOLD})`);
  const dupPairs = [];
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const sim = jaccard(pages[i].shingles, pages[j].shingles);
      if (sim >= DUP_THRESHOLD) dupPairs.push({ a: pages[i].filePath, b: pages[j].filePath, sim });
    }
  }
  dupPairs.sort((a, b) => b.sim - a.sim);
  if (dupPairs.length === 0) lines.push("None found.");
  for (const d of dupPairs) lines.push(`- ${(d.sim * 100).toFixed(0)}% — ${d.a} ↔ ${d.b}`);
  lines.push("");

  if (!gsc) {
    lines.push("## Search Console checks skipped (no GOOGLE_SERVICE_ACCOUNT_KEY)");
    return lines.join("\n");
  }

  // 1. Competing pages
  const { competingQueries, topPairs } = findCompetingPages(gsc.queryPageRows);
  lines.push("## Competing pages (same query, 2+ of our pages shown)");
  if (competingQueries.length === 0) lines.push("None found.");
  for (const c of competingQueries) {
    lines.push(`- "${c.query}": ${c.pages.map(([p, imp]) => `${p.replace(SITE_URL, "")} (${imp})`).join(", ")}`);
  }
  lines.push("");
  lines.push("## Page pairs competing across the most queries");
  if (topPairs.length === 0) lines.push("None found.");
  for (const [pair, info] of topPairs) {
    lines.push(`- ${info.count} shared queries, ${info.impressions} combined impressions — ${pair.replace(new RegExp(SITE_URL, "g"), "")}`);
  }
  lines.push("");

  // 5. Impressions by page
  const byPageSorted = [...gsc.byPageRows].sort((a, b) => b.impressions - a.impressions);
  const pagesWithImpressions = new Set(byPageSorted.map((r) => r.keys[0]));
  lines.push("## Impressions by page (most to least seen)");
  for (const r of byPageSorted) {
    lines.push(`- ${r.impressions} impressions, ${r.clicks} clicks, pos ${Math.round(r.position * 10) / 10} — ${r.keys[0].replace(SITE_URL, "")}`);
  }
  lines.push("");

  // 4. Never shown, 6+ weeks old
  lines.push(`## Pages ${STALE_WEEKS}+ weeks old with zero impressions (${WINDOW_DAYS}-day window)`);
  const stale = pages.filter((p) => p.lastmod && weeksAgo(p.lastmod) >= STALE_WEEKS && !pagesWithImpressions.has(p.url));
  if (stale.length === 0) {
    lines.push("None — but note the domain only migrated recently, so this check isn't reliable yet for most pages.");
  } else {
    for (const p of stale) lines.push(`- ${p.filePath} (lastmod ${p.lastmod}, ${weeksAgo(p.lastmod)}w ago)`);
  }
  lines.push("");
  lines.push("_Caveat: al-systems.co.il only started accumulating Search Console data under the new domain on 2026-10-17. Impression-based checks (competing pages, zero-impression pages) are based on very little data right now and should be re-run in a few weeks for a reliable read. Word count and duplicate-content checks are unaffected by this and are accurate today._");

  return lines.join("\n");
}

async function main() {
  const pages = loadPages();
  const gsc = await fetchGSC();
  const report = buildReport(pages, gsc);
  console.log(report);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
