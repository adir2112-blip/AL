// One-off diagnostic: per-page Search Console performance (clicks, impressions,
// avg position) plus the queries driving each page, printed to the workflow log.
import { google } from "googleapis";

const SITE_URL = "https://adir2112-blip.github.io/AL/";

async function main() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("No GOOGLE_SERVICE_ACCOUNT_KEY set");
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

  const byPage = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions: ["page"],
      rowLimit: 250,
    },
  });

  const pages = byPage.data.rows || [];
  console.log(`\n=== PAGES WITH ANY IMPRESSIONS (90d) — ${pages.length} total ===`);
  pages
    .sort((a, b) => b.impressions - a.impressions)
    .forEach((r) => {
      console.log(
        `${r.keys[0]}\n  clicks=${r.clicks} impressions=${r.impressions} position=${Math.round(r.position * 10) / 10}`
      );
    });

  for (const r of pages) {
    const page = r.keys[0];
    const byQuery = await searchconsole.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: {
        startDate: fmt(start),
        endDate: fmt(end),
        dimensions: ["query"],
        dimensionFilterGroups: [
          { filters: [{ dimension: "page", operator: "equals", expression: page }] },
        ],
        rowLimit: 20,
      },
    });
    const rows = byQuery.data.rows || [];
    console.log(`\n--- queries for ${page} ---`);
    rows.forEach((q) =>
      console.log(
        `  "${q.keys[0]}" clicks=${q.clicks} impressions=${q.impressions} position=${Math.round(q.position * 10) / 10}`
      )
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
