// The SEO self-improvement loop (weekly). Each run:
//   1. sync   — finds out which earlier proposals were merged (live) or closed.
//   2. measure— 14 days after a change went live, compares the page's real
//               Google numbers for the target search with the baseline taken
//               when it was proposed, and records improved / flat / worse.
//   3. learn  — a page that improved can be pushed again (to keep climbing);
//               one that didn't gets a different approach next time, and
//               after two misses in a row it is parked for 45 days.
//   4. act    — picks the best open opportunity (opportunities.mjs) and
//               prepares ONE change for review: added depth for a search the
//               page sits at 8-20 on, or a better title/description for a
//               page that is seen but not clicked. Earlier attempts and their
//               results go into the prompt, so it doesn't repeat what failed.
// State lives in data/seo-actions.json (read by dashboard.html). Nothing is
// published without the owner merging the PR.

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { findOpportunities } from "./opportunities.mjs";

process.env.SKIP_MAIN = "1";
const G = await import("./generate.mjs");

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LEDGER = path.join(ROOT, "data", "seo-actions.json");
const SUMMARY = path.join(ROOT, ".seo-loop-summary");
const REPO = process.env.GITHUB_REPOSITORY || "adir2112-blip/AL";
const SETTLE_DAYS = 3; // GSC needs ~3 days to settle
const MEASURE_DAYS = 14; // how long a change gets before we judge it
const PAGE_COOLDOWN_DAYS = 21; // min gap between changes to one page
const PARK_DAYS = 45; // after two misses in a row
const MAX_PENDING_PRS = 2; // open loop PRs at once
const MIN_ADDED_WORDS = 200;

const DAY = 864e5;
const fmt = (d) => new Date(d).toISOString().slice(0, 10);
const daysAgo = (n) => fmt(Date.now() - n * DAY);
const round1 = (n) => Math.round(n * 10) / 10;
const relOf = (page) => page.replace(G.SITE_URL, "");
const slugOf = (rel) => rel.replace(/^blog\//, "").replace(/\.html$/, "").replace(/[^a-z0-9-]/gi, "-") || "home";

function loadLedger() {
  try { return JSON.parse(fs.readFileSync(LEDGER, "utf8")); } catch { return { actions: [] }; }
}
function saveLedger(l) {
  l.updatedAt = new Date().toISOString();
  fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2) + "\n");
}

// ---------- Search Console ----------
const gsc = process.env.GOOGLE_SERVICE_ACCOUNT_KEY ? G.searchConsoleClient(process.env.GOOGLE_SERVICE_ACCOUNT_KEY) : null;

async function gscRows(startDate, endDate, dimensions, filters = []) {
  if (!gsc) return [];
  const res = await gsc.searchanalytics.query({
    siteUrl: G.GSC_SITE_URL,
    requestBody: {
      startDate, endDate, dimensions, rowLimit: 5000,
      ...(filters.length ? { dimensionFilterGroups: [{ filters }] } : {}),
    },
  });
  return res.data.rows || [];
}

// One page (+ optionally one query) over a window: impressions, clicks, CTR, position.
async function pageStats(page, query, from, to) {
  const filters = [{ dimension: "page", operator: "equals", expression: page }];
  if (query) filters.push({ dimension: "query", operator: "equals", expression: query });
  const rows = await gscRows(from, to, ["page"], filters);
  const r = rows[0];
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1);
  if (!r) return { impressions: 0, clicks: 0, ctr: 0, position: null, perDay: 0, from, to };
  return { impressions: r.impressions, clicks: r.clicks, ctr: round1(r.ctr * 1000) / 10, position: round1(r.position), perDay: round1(r.impressions / days), from, to };
}

// ---------- GitHub ----------
async function gh(pathname) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return null;
  const r = await fetch(`https://api.github.com/repos/${REPO}${pathname}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  return r.ok ? r.json() : null;
}

// 1) proposed -> live / rejected
async function syncStatuses(ledger) {
  const owner = REPO.split("/")[0];
  for (const a of ledger.actions.filter((x) => x.status === "proposed")) {
    const prs = await gh(`/pulls?state=all&head=${owner}:${encodeURIComponent(a.branch)}`);
    const pr = prs && prs[0];
    if (!pr) continue;
    a.pr = pr.number;
    if (pr.merged_at) { a.status = "live"; a.liveAt = pr.merged_at.slice(0, 10); }
    else if (pr.state === "closed") { a.status = "rejected"; a.closedAt = (pr.closed_at || "").slice(0, 10); }
  }
}

// 2) live -> measured
function verdictOf(a, after) {
  const b = a.baseline;
  if (a.kind === "ctr") {
    const before = b.clicks / Math.max(1, b.impressions), now = after.clicks / Math.max(1, after.impressions);
    if (after.impressions < 5) return "no_data";
    if (after.clicks > 0 && now > before) return "improved";
    if (now < before) return "worse";
    return "flat";
  }
  if (after.position == null || after.impressions === 0) return "no_data";
  const d = b.position - after.position; // positive = moved up
  if (d >= 2) return "improved";
  if (d <= -2) return "worse";
  return "flat";
}
async function measure(ledger) {
  for (const a of ledger.actions.filter((x) => x.status === "live" && x.liveAt)) {
    const start = fmt(Date.parse(a.liveAt) + SETTLE_DAYS * DAY);
    const end = fmt(Math.min(Date.parse(a.liveAt) + (SETTLE_DAYS + MEASURE_DAYS) * DAY, Date.now() - SETTLE_DAYS * DAY));
    if ((Date.parse(end) - Date.parse(start)) / DAY < MEASURE_DAYS - 1) continue; // not enough time yet
    const after = await pageStats(a.page, a.kind === "ctr" ? null : a.query, start, end);
    a.result = after;
    a.verdict = verdictOf(a, after);
    a.status = "measured";
    a.measuredAt = fmt(Date.now());
    console.log(`Measured ${a.kind} ${a.page} "${a.query}": ${a.verdict}`, JSON.stringify({ before: a.baseline, after }));
  }
}

// 3) learning: what is each page allowed to get next?
function pageState(ledger, page) {
  const acts = ledger.actions.filter((x) => x.page === page).sort((x, y) => (x.proposedAt < y.proposedAt ? -1 : 1));
  const last = acts[acts.length - 1];
  const measured = acts.filter((x) => x.status === "measured");
  const lastTwo = measured.slice(-2);
  const missesInRow = lastTwo.length === 2 && lastTwo.every((x) => x.verdict !== "improved");
  if (last && last.status === "proposed") return { blocked: "pending" };
  if (last && last.status === "live") return { blocked: "measuring" };
  const lastTouch = last ? Date.parse(last.measuredAt || last.liveAt || last.closedAt || last.proposedAt) : 0;
  if (last && Date.now() - lastTouch < PAGE_COOLDOWN_DAYS * DAY && last.status !== "rejected") return { blocked: "cooldown" };
  if (missesInRow && Date.now() - Date.parse(lastTwo[1].measuredAt) < PARK_DAYS * DAY) return { blocked: "parked" };
  return { history: acts, lastVerdict: measured.length ? measured[measured.length - 1].verdict : null, lastKind: measured.length ? measured[measured.length - 1].kind : null };
}

const VERDICT_HE = { improved: "השתפר", flat: "ללא שינוי", worse: "ירד", no_data: "אין מספיק נתונים" };
function historyText(history) {
  if (!history || !history.length) return "";
  const lines = history.map((a) => {
    const what = a.kind === "ctr" ? `שינוי כותרת ותיאור (לפני: "${a.change?.oldTitle || ""}", אחרי: "${a.change?.newTitle || ""}")` : `הוספת תוכן לחיפוש "${a.query}": ${(a.change?.headings || []).join(" / ")}`;
    const res = a.status === "measured"
      ? `תוצאה: ${VERDICT_HE[a.verdict] || a.verdict} (מיקום ${a.baseline.position} → ${a.result?.position ?? "—"}, קליקים ${a.baseline.clicks} → ${a.result?.clicks ?? 0})`
      : a.status === "rejected" ? "בעל האתר דחה את השינוי" : "עדיין נמדד";
    return `- ${a.proposedAt}: ${what}. ${res}`;
  });
  return "## ניסיונות קודמים בעמוד הזה (למד מהם: אל תחזור על מה שלא עבד, נסה זווית אחרת)\n" + lines.join("\n");
}

// ---------- actions ----------
const CTR_TOOL = {
  name: "rewrite_snippet",
  description: "Write a better Google title and meta description for an existing page, or decline.",
  input_schema: {
    type: "object",
    properties: {
      decision: { type: "string", enum: ["rewrite", "none"] },
      title: { type: "string", description: "Hebrew, max 46 characters, WITHOUT the ' | A.L Systems' suffix. Contains the search phrase naturally." },
      description: { type: "string", description: "Hebrew meta description, 120-155 characters, concrete benefit + what the reader gets." },
      reason: { type: "string", description: "1-2 Hebrew sentences for the owner: why the old snippet wasn't clicked and what changed." },
    },
    required: ["decision", "reason"],
  },
};

function readMeta(html) {
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
  return { title, desc };
}

async function actCtr(opp, state) {
  const rel = relOf(opp.page);
  const file = path.join(ROOT, rel || "index.html");
  if (!fs.existsSync(file)) return null;
  const html = fs.readFileSync(file, "utf8");
  const { title, desc } = readMeta(html);
  if (!title) return null;
  const queries = (await gscRows(daysAgo(31), daysAgo(SETTLE_DAYS), ["query"], [{ dimension: "page", operator: "equals", expression: opp.page }]))
    .sort((a, b) => b.impressions - a.impressions).slice(0, 10)
    .map((r) => `- "${r.keys[0]}" — ${r.impressions} הופעות, ${r.clicks} קליקים, מיקום ${round1(r.position)}`).join("\n");
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = `אתה משפר את התצוגה בגוגל של עמוד באתר A.L Systems (אדיר לוי, שדרות — מערכות AI לעסקים).
העמוד מופיע בגוגל במיקום ממוצע ${opp.position}, קיבל ${opp.impressions} הופעות ב-28 ימים אבל רק ${opp.clicks} קליקים. כלומר אנשים רואים אותו ולא לוחצים.

כותרת נוכחית: ${title}
תיאור נוכחי: ${desc}

החיפושים שבהם הוא מופיע:
${queries}

תוכן העמוד (לקריאה, כדי לא להבטיח משהו שלא כתוב בו):
${G.plainText(html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] || html).slice(0, 6000)}

${historyText(state.history)}

## כללים
- כותרת שעונה בדיוק על מה שהמחפש רוצה, עם הביטוי "${opp.query}" או קרוב אליו, בעברית טבעית. בלי קליקבייט, בלי סימני קריאה, בלי "הכי טוב".
- תיאור שמבטיח רק מה שבאמת יש בעמוד. בלי מספרים, מחירים או לקוחות מומצאים.
- אם הכותרת והתיאור כבר טובים ואין שיפור אמיתי — decision=none.

קרא ל-rewrite_snippet.`;
  const msg = await anthropic.messages.create({
    model: "claude-sonnet-5", max_tokens: 1500, tools: [CTR_TOOL], tool_choice: { type: "tool", name: "rewrite_snippet" },
    messages: [{ role: "user", content: prompt }],
  });
  const out = msg.content.find((b) => b.type === "tool_use")?.input;
  if (!out || out.decision !== "rewrite" || !out.title || !out.description) { console.log("CTR: model declined", out?.reason); return null; }
  let newTitle = out.title.replace(/\s*[|\-–—]\s*A\.?L\.?\s*Systems\s*$/i, "").trim().slice(0, 46);
  const suffix = / \| A\.L Systems$/.test(title) ? " | A.L Systems" : "";
  const fullTitle = G.escAttr(newTitle + suffix);
  const newDesc = G.escAttr(out.description.trim().slice(0, 160));
  let updated = html.replace(/<title>[^<]*<\/title>/, `<title>${fullTitle}</title>`);
  const oldDescEsc = desc;
  for (const [attr, val] of [['name="description"', newDesc], ['property="og:description"', newDesc], ['name="twitter:description"', newDesc]]) {
    updated = updated.replace(new RegExp(`(<meta ${attr} content=")[^"]*(")`), `$1${val}$2`);
  }
  for (const attr of ['property="og:title"', 'name="twitter:title"']) {
    updated = updated.replace(new RegExp(`(<meta ${attr} content=")[^"]*(")`), `$1${G.escAttr(newTitle)}$2`);
  }
  if (updated === html) return null;
  fs.writeFileSync(file, updated);
  try { G.touchSitemapLastmod(rel || ""); } catch (e) { console.log("sitemap touch skipped:", e.message); }
  return { files: [rel || "index.html", "sitemap.xml"], title: newTitle, reason: out.reason, change: { oldTitle: title, newTitle: newTitle + suffix, oldDescription: oldDescEsc, newDescription: out.description.trim() } };
}

async function actStrengthen(opp, state, takenTopics) {
  const rel = relOf(opp.page);
  if (!rel.startsWith("blog/")) return null; // landing pages are hand-written: CTR only
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return null;
  const html = fs.readFileSync(file, "utf8");
  if (!G.hasRefreshAnchors(html)) { console.log(`Strengthen: ${rel} lacks the refresh anchors`); return null; }
  const qrows = await gscRows(daysAgo(31), daysAgo(SETTLE_DAYS), ["query"], [{ dimension: "page", operator: "equals", expression: opp.page }]);
  const candidate = {
    rel, slug: slugOf(rel), html, impressions: opp.impressions, position: opp.position,
    queries: qrows.sort((a, b) => b.impressions - a.impressions).slice(0, 15)
      .map((r) => ({ query: r.keys[0], impressions: r.impressions, position: round1(r.position) })),
  };
  const extra = `## היעד של הסבב הזה
החיפוש "${opp.query}": הפוסט במיקום ${opp.position} (${opp.impressions} הופעות ב-28 ימים), קרוב לעמוד הראשון. התמקד בו: ענה עליו ישירות ובהרחבה, עם כותרת סעיף שמכילה את הביטוי או ניסוח קרוב, ובשאלה נפוצה אחת לפחות סביבו.
${historyText(state.history)}${state.lastVerdict && state.lastVerdict !== "improved" && state.lastKind === "strengthen" ? "\nהניסיון הקודם להוסיף תוכן לא הזיז את הדירוג. הפעם בחר זווית אחרת לגמרי: שאלות מעשיות ספציפיות, השוואה, או צעדים, ולא הרחבה של אותו רעיון." : ""}`;
  const refresh = await G.draftRefresh(candidate, takenTopics, extra);
  if (refresh.decision !== "refresh" || (!refresh.new_sections?.length && !refresh.new_faq?.length)) { console.log("Strengthen: model declined", refresh.reason); return null; }
  const updated = G.applyRefresh(candidate, refresh);
  const added = G.countMainWords(updated) - G.countMainWords(html);
  if (added < MIN_ADDED_WORDS) { console.log(`Strengthen: only ${added} words added`); return null; }
  fs.writeFileSync(file, updated);
  G.touchSitemapLastmod(rel);
  return {
    files: [rel, "sitemap.xml"], title: refresh.title, reason: refresh.reason,
    change: { headings: (refresh.new_sections || []).map((s) => s.heading), faq: (refresh.new_faq || []).map((f) => f.question), addedWords: added },
  };
}

// ---------- main ----------
async function main() {
  const ledger = loadLedger();
  ledger.actions = ledger.actions || [];
  await syncStatuses(ledger);
  await measure(ledger);

  const rows = (await gscRows(daysAgo(31), daysAgo(SETTLE_DAYS), ["page", "query"]))
    .map((r) => ({ page: r.keys[0], query: r.keys[1], impressions: r.impressions, clicks: r.clicks, position: r.position }));
  const opportunities = findOpportunities(rows, { limit: 25 });
  ledger.lastOpportunities = opportunities.slice(0, 10);

  let summary = { act: false };
  const pending = await G.fetchPendingAutoPRHeads();
  if (!gsc || !process.env.ANTHROPIC_API_KEY) {
    summary.reason = "missing credentials";
  } else if (pending.filter((h) => h.startsWith("auto/loop-")).length >= MAX_PENDING_PRS) {
    summary.reason = "loop changes already waiting for review";
  } else {
    const takenTopics = G.readTakenTopics();
    const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
    for (const opp of opportunities) {
      const rel = relOf(opp.page);
      const slug = slugOf(rel);
      if (pending.some((h) => h.endsWith(`-${slug}`))) continue;
      const lastmod = G.sitemapLastmod(sitemap, rel);
      if (opp.kind === "strengthen" && lastmod && Date.now() - Date.parse(lastmod) < 14 * DAY) continue; // just changed by hand or by the weekly bot
      const state = pageState(ledger, opp.page);
      if (state.blocked) { console.log(`Skip ${rel}: ${state.blocked}`); continue; }
      console.log(`Trying ${opp.kind} on ${rel} for "${opp.query}" (pos ${opp.position}, ${opp.impressions} impr)`);
      const baseline = await pageStats(opp.page, opp.kind === "ctr" ? null : opp.query, daysAgo(31), daysAgo(SETTLE_DAYS));
      const done = opp.kind === "ctr" ? await actCtr(opp, state) : await actStrengthen(opp, state, takenTopics);
      if (!done) continue;
      const branch = `auto/loop-${opp.kind}-${slug}`;
      ledger.actions.push({
        id: `${G.TODAY}-${opp.kind}-${slug}`,
        kind: opp.kind, page: opp.page, query: opp.query,
        proposedAt: G.TODAY, status: "proposed", branch,
        baseline, change: done.change, reason: done.reason,
      });
      summary = { act: true, kind: opp.kind, branch, files: done.files, title: done.title, query: opp.query, position: opp.position, reason: done.reason, rel };
      break;
    }
    if (!summary.act) summary.reason = summary.reason || "no actionable opportunity this week";
  }

  saveLedger(ledger);
  fs.writeFileSync(SUMMARY, JSON.stringify(summary) + "\n");
  console.log("Loop summary:", JSON.stringify(summary));
}

main().catch((e) => { console.error(e); process.exit(1); });
