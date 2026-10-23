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
    return { queries: [], pages: [], totals: { clicks: 0, impressions: 0 } };
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

  const [byQuery, byPage] = await Promise.all([
    searchconsole.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: { startDate: fmt(start), endDate: fmt(end), dimensions: ["query"], rowLimit: 25 },
    }),
    searchconsole.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: { startDate: fmt(start), endDate: fmt(end), dimensions: ["page"], rowLimit: 250 },
    }),
  ]);

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

  return { queries, pages: pageBreakdown, totals, indexedPagesWithTraffic: pages.length };
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
  console.log("Wrote data/seo-status.json:", JSON.stringify({ queries: gsc.queries.length, totals: gsc.totals }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
