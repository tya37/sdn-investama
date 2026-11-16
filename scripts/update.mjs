// Mengambil berita (Google News RSS) dan angka indeks (Yahoo Finance), lalu menulis data.json
// Jalan di GitHub Actions (Node 20+, tanpa library tambahan).
import { readFile, writeFile } from "node:fs/promises";

const OUT = "data.json";
const UA = { "User-Agent": "Mozilla/5.0 (compatible; SDN-Investama-Bot)" };

// ====== EDIT DI SINI ======
const NEWS_QUERIES = {
  asia: 'bursa Asia (Nikkei OR "Hang Seng" OR Kospi OR IHSG) when:2d',
  crypto: "Bitcoin when:2d",
};
const INDICES = [
  ["IHSG", "^JKSE"],
  ["NIKKEI 225", "^N225"],
  ["HANG SENG", "^HSI"],
  ["CSI 300", "000300.SS"],
];
const MAX_ITEMS = 6;
// ==========================

const decode = (s) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, "")
   .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
   .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
};

export function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const b = m[1];
    let title = tag(b, "title");
    let source = tag(b, "source");
    const cut = title.lastIndexOf(" - ");
    if (cut > 0) {
      if (!source) source = title.slice(cut + 3);
      title = title.slice(0, cut);
    }
    const pub = tag(b, "pubDate");
    return { title, source: source || "Berita", date: pub ? new Date(pub).toISOString() : "", url: tag(b, "link") };
  }).filter((x) => x.title && x.url);
}

async function getNews(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=id&gl=ID&ceid=ID:id`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error("RSS " + r.status);
  const items = parseRss(await r.text());
  items.sort((a, b) => (b.date > a.date ? 1 : -1));
  return items.slice(0, MAX_ITEMS);
}

const fmt = (n) => n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function getIndex([name, sym]) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error("Yahoo " + r.status);
  const meta = (await r.json()).chart.result[0].meta;
  const price = meta.regularMarketPrice, prev = meta.chartPreviousClose;
  const pct = ((price - prev) / prev) * 100;
  const up = pct >= 0;
  const when = new Date((meta.regularMarketTime || Date.now() / 1000) * 1000)
    .toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
  return [name, fmt(price), (up ? "+" : "−") + Math.abs(pct).toFixed(2).replace(".", ",") + "%", up ? "up" : "dn", when];
}

async function main() {
  let old = {};
  try { old = JSON.parse(await readFile(OUT, "utf8")); } catch {}
  const data = { updated: new Date().toISOString(), asia: old.asia || [], crypto: old.crypto || [], indices: old.indices || [] };

  for (const k of Object.keys(NEWS_QUERIES)) {
    try { const n = await getNews(NEWS_QUERIES[k]); if (n.length) data[k] = n; }
    catch (e) { console.error("Gagal berita", k, e.message); }
  }
  const idx = [];
  for (const i of INDICES) {
    try { idx.push(await getIndex(i)); }
    catch (e) {
      console.error("Gagal indeks", i[0], e.message);
      const prev = (old.indices || []).find((x) => x[0] === i[0]);
      if (prev) idx.push(prev);
    }
  }
  if (idx.length) data.indices = idx;

  await writeFile(OUT, JSON.stringify(data, null, 1));
  console.log("OK", data.updated);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) main();
