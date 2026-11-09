// Writes data/seo-status.json: a small public snapshot of Search Console
// performance data, read by dashboard.html. No secrets in the output file -
// this is just aggregate query/click/impression numbers.

import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
// Verified as a domain-level property in Search Console, so the API needs
// the sc-domain: identifier, not a URL-prefix string.
const SITE_URL = "sc-domain:al-systems.co.il";

// The money keywords we track week over week (exact Search Console query
// text, lowercase). A daily site-wide average position is too noisy with
// ~20 impressions a day, so the dashboard leads with these instead.
const TRACKED_QUERIES = [
  "סוכן ai לעסק",
  "סידור עבודה",
  "מערכת סידור עבודה",
  "הקלטת שיחות",
  "הקלטת שיחות באייפון",
  "ניתוח שיחות",
  "מערכת ניהול מסמכים עסקיים",
  "דשבורד מכירות",
  "בוט וואטסאפ לעסק",
  "כמה עולה אוטומציה",
];

// GSC needs ~3 days to settle, so a "week" ends 3 days ago: the last 7
// settled days vs the 7 before them.
function weekWindows(now) {
  const day = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
  return { current: { from: day(9), to: day(3) }, previous: { from: day(16), to: day(10) } };
}

function summarizeQueryRows(rows) {
  const out = { clicks: 0, impressions: 0, queries: rows.length, top10: 0, top20: 0 };
  for (const r of rows) {
    out.clicks += r.clicks;
    out.impressions += r.impressions;
    if (r.position <= 10) out.top10++;
    if (r.position <= 20) out.top20++;
  }
  return out;
}

async function fetchSearchConsoleData() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.warn("No GOOGLE_SERVICE_ACCOUNT_KEY set — writing an empty snapshot.");
    return { queries: [], pages: [], totals: { clicks: 0, impressions: 0 }, indexedPagesWithTraffic: 0, avgPosition: null, dailyBreakdown: [], weekly: null, tracked: [] };
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

  const [byQuery, byPage, byDate, byDateQuery] = await Promise.all([
    searchconsole.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: { startDate: fmt(start), endDate: fmt(end), dimensions: ["query"], rowLimit: 25 },
    }),
    searchconsole.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: { startDate: fmt(start), endDate: fmt(end), dimensions: ["page"], rowLimit: 250 },
    }),
    // Real per-day figures (not a rolling-window total) — dimensions:["date"]
    // makes GSC aggregate each day on its own, with its own position average.
    searchconsole.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: { startDate: fmt(start), endDate: fmt(end), dimensions: ["date"], rowLimit: 100 },
    }),
    // Which specific queries drove each day — so "what worked" can be
    // answered per day, not just guessed from a 90-day rolling top-25.
    // rowLimit 1000 is generous headroom; at our current query diversity
    // this is nowhere close to being hit.
    searchconsole.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: { startDate: fmt(start), endDate: fmt(end), dimensions: ["date", "query"], rowLimit: 5000 },
    }),
  ]);

  // Week over week: every query we appeared for in each settled week.
  const wins = weekWindows(end);
  const [wkCur, wkPrev] = await Promise.all(
    [wins.current, wins.previous].map((w) =>
      searchconsole.searchanalytics.query({
        siteUrl: SITE_URL,
        requestBody: { startDate: w.from, endDate: w.to, dimensions: ["query"], rowLimit: 5000 },
      })
    )
  );
  const toRows = (res) => (res.data.rows || []).map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position }));
  const curRows = toRows(wkCur), prevRows = toRows(wkPrev);
  const weekly = {
    current: { ...wins.current, ...summarizeQueryRows(curRows) },
    previous: { ...wins.previous, ...summarizeQueryRows(prevRows) },
  };
  const pick = (rows, q) => {
    const r = rows.find((x) => x.query.toLowerCase().trim() === q);
    return r ? { impressions: r.impressions, clicks: r.clicks, position: Math.round(r.position * 10) / 10 } : null;
  };
  const tracked = TRACKED_QUERIES.map((q) => ({ query: q, current: pick(curRows, q), previous: pick(prevRows, q) }));

  // GSC's own data for the most recent ~2 days is typically provisional and
  // can still revise upward as Google finishes processing it — flag those
  // dates so a flat or low last point isn't mistaken for a real stall.
  const PROVISIONAL_DAYS = 2;
  const provisionalCutoff = new Date(end);
  provisionalCutoff.setDate(provisionalCutoff.getDate() - PROVISIONAL_DAYS);
  const provisionalCutoffStr = fmt(provisionalCutoff);

  // Group the (date, query) rows by date, keeping each day's top 5 queries by
  // impressions — this is what lets "what drove today's number" be answered
  // with real data instead of guessed from the 90-day rolling top-25.
  const queriesByDate = new Map();
  for (const r of byDateQuery.data.rows || []) {
    const [date, query] = r.keys;
    if (!queriesByDate.has(date)) queriesByDate.set(date, []);
    queriesByDate.get(date).push({
      query,
      clicks: r.clicks,
      impressions: r.impressions,
      position: Math.round(r.position * 10) / 10,
    });
  }
  // Per-day reach: how many different searches we showed up for, and how
  // many of them on page 1 — counted before trimming to the top 5.
  const reachByDate = new Map();
  for (const [date, qs] of queriesByDate) {
    reachByDate.set(date, { queries: qs.length, top10: qs.filter((q) => q.position <= 10).length });
    qs.sort((a, b) => b.impressions - a.impressions);
    queriesByDate.set(date, qs.slice(0, 5));
  }

  const dailyBreakdown = (byDate.data.rows || [])
    .map((r) => ({
      date: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      position: Math.round(r.position * 10) / 10,
      provisional: r.keys[0] >= provisionalCutoffStr,
      queries: reachByDate.get(r.keys[0])?.queries ?? 0,
      top10: reachByDate.get(r.keys[0])?.top10 ?? 0,
      topQueries: queriesByDate.get(r.keys[0]) || [],
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const queries = (byQuery.data.rows || []).map((r) => ({
    query: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    position: Math.round(r.position * 10) / 10,
  }));

  const pages = byPage.data.rows || [];
  const totals = pages.reduce(
    (acc, r) => ({ clicks: acc.clicks + r.clicks, impressions: acc.impressions + r.impressions }),
    { clicks: 0, impressions: 0 }
  );

  // Impressions-weighted average position across the top queries — a single
  // number to track over time. Rolling 90-day window, so this moves like a
  // slow moving average day to day, not a daily-isolated figure.
  const positionWeight = queries.reduce((acc, q) => acc + q.position * q.impressions, 0);
  const positionImpressions = queries.reduce((acc, q) => acc + q.impressions, 0);
  const avgPosition = positionImpressions > 0 ? Math.round((positionWeight / positionImpressions) * 10) / 10 : null;

  const topPages = pages
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 10);

  const pageBreakdown = [];
  for (const r of topPages) {
    const page = r.keys[0];
    const byPageQuery = await searchconsole.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: {
        startDate: fmt(start),
        endDate: fmt(end),
        dimensions: ["query"],
        dimensionFilterGroups: [
          { filters: [{ dimension: "page", operator: "equals", expression: page }] },
        ],
        rowLimit: 5,
      },
    });
    pageBreakdown.push({
      page,
      clicks: r.clicks,
      impressions: r.impressions,
      position: Math.round(r.position * 10) / 10,
      topQueries: (byPageQuery.data.rows || []).map((q) => ({
        query: q.keys[0],
        clicks: q.clicks,
        impressions: q.impressions,
        position: Math.round(q.position * 10) / 10,
      })),
    });
  }

  return { queries, pages: pageBreakdown, totals, indexedPagesWithTraffic: pages.length, avgPosition, dailyBreakdown, weekly, tracked };
}

// Upserts every real GSC day (dimensions:["date"], not a rolling-window total)
// into data/seo-history.json by date. Re-running the snapshot replaces each
// date's point with GSC's latest figures for it instead of duplicating —
// which also means a "provisional" day from a few runs ago quietly gets
// corrected once GSC finishes processing it.
//
// Dates from before this property had real GSC data (see docs/seo-measurement.md)
// aren't touched: GSC simply returns no row for them, so whatever's already
// recorded for those dates stays as the historical record.
function updateHistory(dailyBreakdown) {
  const file = path.join(ROOT, "data", "seo-history.json");
  let history = [];
  if (fs.existsSync(file)) {
    try {
      history = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      history = [];
    }
  }
  const byDate = new Map(history.map((h) => [h.date, h]));
  for (const row of dailyBreakdown) {
    byDate.set(row.date, {
      date: row.date,
      avgPosition: row.position,
      clicks: row.clicks,
      impressions: row.impressions,
      provisional: row.provisional,
      queries: row.queries,
      top10: row.top10,
      topQueries: row.topQueries,
    });
  }
  history = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  fs.writeFileSync(file, JSON.stringify(history, null, 2) + "\n");
  console.log(`Updated data/seo-history.json: ${history.length} points (${dailyBreakdown.length} from today's GSC daily breakdown)`);
}

async function main() {
  const gsc = await fetchSearchConsoleData();
  const snapshot = {
    generatedAt: new Date().toISOString(),
    windowDays: 90,
    ...gsc,
  };
  fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "data", "seo-status.json"), JSON.stringify(snapshot, null, 2) + "\n");
  console.log("Wrote data/seo-status.json:", JSON.stringify({ queries: gsc.queries.length, totals: gsc.totals, avgPosition: gsc.avgPosition }));
  if (snapshot.dailyBreakdown.length > 0) updateHistory(snapshot.dailyBreakdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
