export interface PageContent {
  url: string;
  title: string;
  h1: string;
  h2s: string[];
  meta: string;
  bodySnippet: string;
  blocked: boolean; // true if fetch failed or was blocked (403, timeout, Cloudflare, etc.)
}

export async function fetchPageContent(url: string): Promise<PageContent> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.log(`[ContentFetcher] Blocked: ${url} -> ${res.status}`);
      return { url, title: "", h1: "", h2s: [], meta: "", bodySnippet: "", blocked: true };
    }

    const html = await res.text();
    // Detect Cloudflare / bot protection pages
    if (html.includes("cf-browser-verification") || html.includes("Just a moment") || html.length < 500) {
      console.log(`[ContentFetcher] Bot-blocked: ${url}`);
      return { url, title: "", h1: "", h2s: [], meta: "", bodySnippet: "", blocked: true };
    }

    return { ...parseHtml(url, html), blocked: false };
  } catch (e) {
    console.log(`[ContentFetcher] Fetch error: ${url} -> ${e instanceof Error ? e.message : "unknown"}`);
    return { url, title: "", h1: "", h2s: [], meta: "", bodySnippet: "", blocked: true };
  }
}

function parseHtml(url: string, html: string): PageContent {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : "";

  // Extract meta description
  const metaMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["'][^>]*>/i)
    || html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["'][^>]*>/i);
  const meta = metaMatch ? decodeEntities(metaMatch[1].trim()) : "";

  // Extract H1
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1 = h1Match ? stripTags(decodeEntities(h1Match[1].trim())) : "";

  // Extract H2s
  const h2Regex = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  const h2s: string[] = [];
  let h2Match;
  while ((h2Match = h2Regex.exec(html)) !== null && h2s.length < 15) {
    h2s.push(stripTags(decodeEntities(h2Match[1].trim())));
  }

  // Extract body text (strip nav, header, footer, script, style)
  let body = html;
  // Remove script, style, nav, header, footer tags and content
  body = body.replace(/<(script|style|nav|header|footer|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Remove all HTML tags
  body = stripTags(body);
  // Collapse whitespace
  body = body.replace(/\s+/g, " ").trim();
  // Take first 2000 chars as snippet
  const bodySnippet = body.slice(0, 2000);

  return { url, title, h1, h2s, meta, bodySnippet, blocked: false };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
