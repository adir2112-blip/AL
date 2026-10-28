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

async function fetchSearchConsoleData() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.warn("No GOOGLE_SERVICE_ACCOUNT_KEY set — writing an empty snapshot.");
    return { queries: [], pages: [], totals: { clicks: 0, impressions: 0 }, indexedPagesWithTraffic: 0, avgPosition: null, dailyBreakdown: [] };
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

  const [byQuery, byPage, byDate] = await Promise.all([
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
  ]);

  // GSC's own data for the most recent ~2 days is typically provisional and
  // can still revise upward as Google finishes processing it — flag those
  // dates so a flat or low last point isn't mistaken for a real stall.
  const PROVISIONAL_DAYS = 2;
  const provisionalCutoff = new Date(end);
  provisionalCutoff.setDate(provisionalCutoff.getDate() - PROVISIONAL_DAYS);
  const provisionalCutoffStr = fmt(provisionalCutoff);

  const dailyBreakdown = (byDate.data.rows || [])
    .map((r) => ({
      date: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      position: Math.round(r.position * 10) / 10,
      provisional: r.keys[0] >= provisionalCutoffStr,
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

  return { queries, pages: pageBreakdown, totals, indexedPagesWithTraffic: pages.length, avgPosition, dailyBreakdown };
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
