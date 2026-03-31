const BASE_URL = "https://api.mangools.com/v3";
const API_KEY = process.env.MANGOOLS_API_KEY!;

// Rate limit: 3 requests per short period. 2-3s delay between calls.
let lastCallTime = 0;

async function rateLimitedFetch(url: string, init?: RequestInit): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < 2500) {
    await new Promise((r) => setTimeout(r, 2500 - elapsed));
  }
  lastCallTime = Date.now();

  const res = await fetch(url, {
    ...init,
    headers: {
      "X-Access-Token": API_KEY,
      ...init?.headers,
    },
  });

  if (res.status === 429) {
    // Rate limited - wait 5s and retry once
    await new Promise((r) => setTimeout(r, 5000));
    lastCallTime = Date.now();
    return fetch(url, {
      ...init,
      headers: {
        "X-Access-Token": API_KEY,
        ...init?.headers,
      },
    });
  }

  return res;
}

export interface SerpResult {
  keyword: string;
  volume: number;
  kd: number;
  items: SerpItem[];
  rawResponse: string; // Full JSON for logging
}

export interface SerpItem {
  url: string;
  da: number;
  pa: number;
  title: string;
  position: number;
}

export async function fetchSerp(
  keyword: string,
  locationId: number,
  languageId: number = 1000
): Promise<SerpResult> {
  const params = new URLSearchParams({
    kw: keyword,
    location_id: String(locationId),
    language_id: String(languageId),
  });

  const res = await rateLimitedFetch(`${BASE_URL}/kwfinder/serps?${params}`);
  if (!res.ok) {
    throw new Error(`Mangools SERP error ${res.status}: ${await res.text()}`);
  }

  const raw = await res.text();
  const data = JSON.parse(raw);

  // Confirmed structure from live API:
  // data.serp = { items: [...], rank: KD, ... }
  // item = { url, title, serpRank, m: { moz: { v: { pda, upa } } } }
  const serpObj = data.serp as Record<string, unknown> | null;
  const rawItems: Record<string, unknown>[] = Array.isArray(serpObj?.items)
    ? (serpObj!.items as Record<string, unknown>[])
    : [];

  console.log(`[Mangools SERP] ${rawItems.length} organic items`);

  const items: SerpItem[] = rawItems
    .filter((r) => typeof r.url === "string" && (r.url as string).startsWith("http"))
    .slice(0, 10)
    .map((r) => {
      const moz = (r.m as Record<string, Record<string, Record<string, number>>> | undefined)?.moz?.v;
      return {
        url: r.url as string,
        da: moz?.pda ?? 0,
        pa: moz?.upa ?? 0,
        title: r.title as string || "",
        position: r.serpRank as number || 0,
      };
    });

  // KD is at data.serp.rank (confirmed from live API)
  const kd = (serpObj?.rank as number) ?? 0;
  const volume = 0; // Always fetch volume via keyword-imports, not SERP

  return {
    keyword,
    volume: Number(volume),
    kd: Number(kd),
    items,
    rawResponse: raw,
  };
}

export interface RelatedKeyword {
  keyword: string;
  volume: number;
  kd: number;
}

export async function fetchRelatedKeywords(
  keyword: string,
  locationId: number,
  languageId: number = 1000
): Promise<RelatedKeyword[]> {
  const params = new URLSearchParams({
    kw: keyword,
    location_id: String(locationId),
    language_id: String(languageId),
  });

  const res = await rateLimitedFetch(`${BASE_URL}/kwfinder/related-keywords?${params}`);
  if (!res.ok) {
    throw new Error(`Mangools related-keywords error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();

  return (data.keywords || []).map((kw: Record<string, unknown>) => ({
    keyword: kw.kw as string || kw.keyword as string || "",
    volume: Number(kw.sv ?? kw.volume ?? 0),
    kd: Number(kw.kd ?? 0),
  }));
}

export interface KeywordImportResult {
  keyword: string;
  volume: number;
  kd: number;
}

export async function fetchKeywordImports(
  keywords: string[],
  locationId: number,
  languageId: number = 1000
): Promise<KeywordImportResult[]> {
  const res = await rateLimitedFetch(`${BASE_URL}/kwfinder/keyword-imports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keywords, location_id: locationId, language_id: languageId }),
  });

  if (!res.ok) {
    throw new Error(`Mangools keyword-imports error ${res.status}: ${await res.text()}`);
  }

  const raw = await res.text();
  const data = JSON.parse(raw);

  // Log raw structure so we can verify field paths
  console.log("[Mangools keyword-imports] top-level keys:", Object.keys(data));
  const firstKw = (data.keywords || data.data || [])[0];
  if (firstKw) console.log("[Mangools keyword-imports] keyword[0] keys:", Object.keys(firstKw), JSON.stringify(firstKw).slice(0, 300));

  const list: Record<string, unknown>[] = data.keywords || data.data || [];

  return list.map((kw) => ({
    keyword: kw.kw as string || kw.keyword as string || "",
    volume: Number(kw.sv ?? kw.search_volume ?? kw.vol ?? kw.volume ?? 0),
    kd: Number(kw.seo ?? kw.kd ?? 0),
  }));
}

export interface SiteProfilerResult {
  da: number;
  pa: number;
  trustFlow: number;
  citationFlow: number;
}

export async function fetchSiteProfiler(domain: string): Promise<SiteProfilerResult> {
  const params = new URLSearchParams({ url: domain });
  const res = await rateLimitedFetch(`${BASE_URL}/siteprofiler/overview?${params}`);
  if (!res.ok) {
    throw new Error(`Mangools SiteProfiler error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return {
    da: data.moz?.pda ?? 0,
    pa: data.moz?.upa ?? 0,
    trustFlow: data.majestic?.TrustFlow ?? 0,
    citationFlow: data.majestic?.CitationFlow ?? 0,
  };
}

export async function checkLimits(): Promise<Record<string, unknown>> {
  const res = await rateLimitedFetch(`${BASE_URL}/kwfinder/limits`);
  if (!res.ok) {
    throw new Error(`Mangools limits error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}
