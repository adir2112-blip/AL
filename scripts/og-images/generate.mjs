// Generates a branded 1200x630 OG/share image for every page in sitemap.xml,
// and points that page's og:image / twitter:image meta tags at it.
// Safe to re-run anytime (e.g. after a new blog post) — it regenerates every
// image and only touches files whose meta tags actually change.

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SITE_URL = "https://al-systems.co.il/";
const SELF = import.meta.dirname;

const assistant = fs.readFileSync(path.join(SELF, "fonts", "assistant.ttf"));
const frankruhl = fs.readFileSync(path.join(SELF, "fonts", "frankruhl.ttf"));
const logoPng = fs.readFileSync(path.join(ROOT, "assets", "logo-mark-transparent.png"));
const logoDataUri = "data:image/png;base64," + logoPng.toString("base64");

function readSitemapEntries() {
  const xml = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  const entries = [];
  for (const block of xml.match(/<url>[\s\S]*?<\/url>/g) || []) {
    const loc = block.match(/<loc>(.*?)<\/loc>/)?.[1];
    if (!loc) continue;
    const rel = loc.replace(SITE_URL, "");
    const filePath = rel === "" ? "index.html" : rel;
    entries.push(filePath);
  }
  return entries;
}

function extractTitle(html, filePath) {
  const raw = html.match(/<title>(.*?)<\/title>/)?.[1] || "";
  const parts = raw.split(" | ").map((s) => s.trim());
  // index.html is "A.L Systems | <subtitle>" — every other page is "<title> | A.L Systems"
  const title = filePath === "index.html" ? parts[1] || parts[0] : parts[0];
  const eyebrow = filePath.startsWith("blog/") ? "A.L Systems · בלוג" : "A.L Systems";
  return { title, eyebrow };
}

function wrapLines(text, maxCharsPerLine) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? cur + " " + w : w;
    if (candidate.length > maxCharsPerLine && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

async function renderOg(title, eyebrow) {
  const fontSize = title.length > 55 ? 46 : title.length > 38 ? 54 : 62;
  const maxChars = Math.floor(1060 / (fontSize * 0.95));
  const lines = wrapLines(title, maxChars);

  const row = (children, extraStyle) => ({
    type: "div",
    props: {
      style: {
        display: "flex",
        width: "1060px",
        justifyContent: "flex-start",
        direction: "rtl",
        ...extraStyle,
      },
      children,
    },
  });

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "70px",
          background: "linear-gradient(135deg, #362721 0%, #1C2530 100%)",
          fontFamily: "Assistant",
        },
        children: [
          row(
            [
              {
                type: "div",
                props: {
                  style: { fontSize: "26px", color: "#DDB05F", fontWeight: 700, letterSpacing: "0.02em" },
                  children: eyebrow,
                },
              },
              { type: "img", props: { src: logoDataUri, width: 40, height: 36 } },
            ],
            { alignItems: "center", gap: "14px" }
          ),
          {
            type: "div",
            props: {
              style: { display: "flex", flexDirection: "column", gap: "6px" },
              children: lines.map((line) =>
                row(line, { fontSize: fontSize + "px", color: "#FBF8F2", fontFamily: "FrankRuhlLibre", fontWeight: 700, lineHeight: 1.25 })
              ),
            },
          },
          row("al-systems.co.il", { alignItems: "center", fontSize: "24px", color: "rgba(251,248,242,0.7)" }),
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Assistant", data: assistant, weight: 700, style: "normal" },
        { name: "FrankRuhlLibre", data: frankruhl, weight: 700, style: "normal" },
      ],
    }
  );

  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } });
  return resvg.render().asPng();
}

function slugFor(filePath) {
  if (filePath === "index.html") return "index";
  return filePath.replace(/\.html$/, "").replace(/\//g, "-");
}

function updateMetaTags(html, ogUrl) {
  let updated = html;
  let changed = false;
  for (const pattern of [
    /(<meta property="og:image" content=")[^"]*(")/,
    /(<meta name="twitter:image" content=")[^"]*(")/,
  ]) {
    if (pattern.test(updated)) {
      const next = updated.replace(pattern, `$1${ogUrl}$2`);
      if (next !== updated) changed = true;
      updated = next;
    }
  }
  return { updated, changed };
}

async function main() {
  const entries = readSitemapEntries();
  let imagesWritten = 0;
  let filesUpdated = 0;

  for (const filePath of entries) {
    const fp = path.join(ROOT, filePath);
    if (!fs.existsSync(fp)) {
      console.warn(`skip (no local file): ${filePath}`);
      continue;
    }
    const html = fs.readFileSync(fp, "utf8");
    const { title, eyebrow } = extractTitle(html, filePath);
    if (!title) {
      console.warn(`skip (no title): ${filePath}`);
      continue;
    }

    const png = await renderOg(title, eyebrow);
    const slug = slugFor(filePath);
    const ogPath = path.join(ROOT, "assets", "og", `${slug}.png`);
    fs.writeFileSync(ogPath, png);
    imagesWritten++;

    const ogUrl = `${SITE_URL}assets/og/${slug}.png`;
    const { updated, changed } = updateMetaTags(html, ogUrl);
    if (changed) {
      fs.writeFileSync(fp, updated);
      filesUpdated++;
    }
  }

  console.log(`OG images written: ${imagesWritten}`);
  console.log(`HTML files updated: ${filesUpdated}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
