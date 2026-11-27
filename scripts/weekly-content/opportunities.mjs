// Finds where a small push is most likely to move the site up in Google.
// Shared by snapshot.mjs (daily, for the dashboard + weekly WhatsApp report)
// and seo-loop.mjs (weekly, which acts on the best one).
//
//   strengthen — a (page, query) pair sitting at positions 8-20: Google
//                already ties the page to the search, so added depth on that
//                exact search is the cheapest way onto page 1.
//   ctr        — a page already on/near page 1 that gets seen but not
//                clicked: the title/description is what needs work.

export const STRIKING_MIN_POS = 8;
export const STRIKING_MAX_POS = 20;
export const STRIKING_MIN_IMPRESSIONS = 3;
export const CTR_MAX_POS = 12;
export const CTR_MIN_IMPRESSIONS = 20;
export const CTR_MAX_RATE = 0.02;

const round1 = (n) => Math.round(n * 10) / 10;

// rows: [{ page, query, impressions, clicks, position }] from GSC
// dimensions ["page", "query"] over the last ~28 settled days.
export function findOpportunities(rows, { limit = 10 } = {}) {
  const out = [];
  for (const r of rows) {
    if (r.position < STRIKING_MIN_POS || r.position > STRIKING_MAX_POS) continue;
    if (r.impressions < STRIKING_MIN_IMPRESSIONS) continue;
    out.push({
      kind: "strengthen",
      page: r.page,
      query: r.query,
      position: round1(r.position),
      impressions: r.impressions,
      clicks: r.clicks,
      // more impressions and closer to page 1 = bigger, faster win
      score: round1(r.impressions * (STRIKING_MAX_POS + 1 - r.position)),
    });
  }

  const byPage = new Map();
  for (const r of rows) {
    const a = byPage.get(r.page) || { impressions: 0, clicks: 0, wpos: 0, top: null };
    a.impressions += r.impressions;
    a.clicks += r.clicks;
    a.wpos += r.position * r.impressions;
    if (!a.top || r.impressions > a.top.impressions) a.top = r;
    byPage.set(r.page, a);
  }
  for (const [page, a] of byPage) {
    const pos = a.wpos / a.impressions;
    if (pos > CTR_MAX_POS || a.impressions < CTR_MIN_IMPRESSIONS) continue;
    if (a.clicks / a.impressions > CTR_MAX_RATE) continue;
    out.push({
      kind: "ctr",
      page,
      query: a.top.query,
      position: round1(pos),
      impressions: a.impressions,
      clicks: a.clicks,
      score: round1(a.impressions * 1.5),
    });
  }

  out.sort((x, y) => y.score - x.score);
  return out.slice(0, limit);
}

// longtail — an addition to the two kinds above, not a replacement. A search
// of 4+ words that the site already shows up for, but deep or barely clicked:
// someone asked a specific question and we only half-answer it. The fix is a
// section or FAQ that answers that exact question on the page Google already
// ties to it. Pairs already covered by findOpportunities() are skipped.
export const LONGTAIL_MIN_WORDS = 4;
export const LONGTAIL_MIN_IMPRESSIONS = 5;
export const LONGTAIL_MAX_CTR = 0.02;

const wordCount = (q) => String(q || "").trim().split(/\s+/).filter(Boolean).length;

export function findLongTail(rows, { limit = 10, exclude = [] } = {}) {
  const skip = new Set(exclude.map((o) => `${o.page}|${o.query}`));
  // One row per query: keep the page Google shows most for it.
  const byQuery = new Map();
  for (const r of rows) {
    if (wordCount(r.query) < LONGTAIL_MIN_WORDS) continue;
    const a = byQuery.get(r.query) || { impressions: 0, clicks: 0, wpos: 0, top: null };
    a.impressions += r.impressions;
    a.clicks += r.clicks;
    a.wpos += r.position * r.impressions;
    if (!a.top || r.impressions > a.top.impressions) a.top = r;
    byQuery.set(r.query, a);
  }
  const out = [];
  for (const [query, a] of byQuery) {
    if (a.impressions < LONGTAIL_MIN_IMPRESSIONS) continue;
    if (a.clicks / a.impressions > LONGTAIL_MAX_CTR) continue;
    if (skip.has(`${a.top.page}|${query}`)) continue;
    const pos = a.wpos / a.impressions;
    out.push({
      kind: "longtail",
      page: a.top.page,
      query,
      words: wordCount(query),
      position: round1(pos),
      impressions: a.impressions,
      clicks: a.clicks,
      score: round1(a.impressions * (1 + 10 / Math.max(pos, 1))),
    });
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, limit);
}
