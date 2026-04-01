import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Classify URL type from path pattern
function classifyUrl(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path === "/" || path === "") return "homepage";
    if (/^\/blog\//.test(path) || /^\/resources\//.test(path) || /^\/articles\//.test(path)) return "blog";
    if (/^\/locations?\/?$/.test(path) || /^\/areas?\/?$/.test(path)) return "location-hub";
    if (/^\/services?\/?$/.test(path) || /^\/what-we-do\/?$/.test(path)) return "service-hub";
    // Geo-service: path contains both a service-like term and looks geo-specific (long slug with city names)
    if (/^\/services?\/[^/]+-[^/]+/.test(path) || /^\/locations?\/[^/]+\//.test(path)) return "geo-service";
    if (/^\/services?\/[^/]+\/?$/.test(path)) return "service-page";
    return "other";
  } catch {
    return "other";
  }
}

// Generate cannibalization suggestion based on the pattern
function generateCannSuggestion(
  pages: { url: string; avgPosition: number; impressions: number; urlType: string }[],
  query: string
): string {
  if (pages.length < 2) return "";

  const sorted = [...pages].sort((a, b) => a.avgPosition - b.avgPosition);
  const strongest = sorted[0];
  const totalImp = pages.reduce((sum, p) => sum + p.impressions, 0);
  const strongestShare = Math.round((strongest.impressions / totalImp) * 100);

  // Blog vs service page competing
  const hasBlog = pages.some((p) => p.urlType === "blog");
  const hasService = pages.some((p) => ["service-page", "geo-service", "service-hub"].includes(p.urlType));
  if (hasBlog && hasService) {
    const servicePage = pages.find((p) => ["service-page", "geo-service", "service-hub"].includes(p.urlType));
    const blogPage = pages.find((p) => p.urlType === "blog");
    return `Service page should own this commercial query. Add internal link from ${blogPage ? new URL(blogPage.url).pathname : "blog post"} to ${servicePage ? new URL(servicePage.url).pathname : "service page"}. Remove keyword targeting from blog title tag.`;
  }

  // Homepage vs dedicated page
  const hasHomepage = pages.some((p) => p.urlType === "homepage");
  const hasDedicated = pages.some((p) => !["homepage", "other"].includes(p.urlType));
  if (hasHomepage && hasDedicated) {
    const dedicated = pages.find((p) => !["homepage", "other"].includes(p.urlType));
    return `Dedicated page ${dedicated ? new URL(dedicated.url).pathname : ""} should rank for this. Reduce keyword signals on homepage or add canonical.`;
  }

  // Multiple similar pages
  if (pages.length >= 3) {
    return `Severe cannibalization: ${pages.length} pages compete. Consolidate to ${new URL(strongest.url).pathname} (strongest at pos ${strongest.avgPosition.toFixed(1)}). Consider 301 redirects or deoptimizing weaker pages.`;
  }

  // 2 pages, one clearly winning
  if (strongestShare >= 70) {
    const weaker = sorted[1];
    return `${new URL(strongest.url).pathname} owns ${strongestShare}% of impressions. Deoptimize or redirect ${new URL(weaker.url).pathname} to consolidate.`;
  }

  // 2 pages, split roughly even
  return `Even split between ${new URL(sorted[0].url).pathname} (pos ${sorted[0].avgPosition.toFixed(1)}) and ${new URL(sorted[1].url).pathname} (pos ${sorted[1].avgPosition.toFixed(1)}). Choose one to own this keyword. 301 or deoptimize the other.`;
}

// Determine action recommendation for a single-page ranking
function classifyAction(
  url: string,
  urlType: string,
  position: number,
  keyword: string
): { action: string; suggestion: string } {
  const pathname = new URL(url).pathname;

  // Blog ranking for what's likely a commercial query
  if (urlType === "blog") {
    return {
      action: "Create New Page",
      suggestion: `Blog post ${pathname} ranks for a commercial query. Create a dedicated service/location page and add an internal link from the blog post.`,
    };
  }

  // Homepage ranking for a geo-specific query
  if (urlType === "homepage") {
    return {
      action: "Create New Page",
      suggestion: `Homepage ranks for a geo-specific query. Create a dedicated page to capture this keyword properly.`,
    };
  }

  // Service hub (generic /services/) ranking for specific query
  if (urlType === "service-hub" && position > 15) {
    return {
      action: "Create New Page",
      suggestion: `General services page ranks at pos ${position.toFixed(0)}. A dedicated page would consolidate ranking signals. Link from the services hub.`,
    };
  }

  // Correct page type, strong position
  if (position <= 10) {
    return {
      action: "Strengthen",
      suggestion: `Ranking pos ${position.toFixed(0)} from ${pathname}. Push for top 3: check internal linking, consider supporting blog content for topical authority, review backlink opportunities.`,
    };
  }

  // Correct page type, striking distance
  if (position <= 15) {
    return {
      action: "Optimize Existing",
      suggestion: `Pos ${position.toFixed(0)} from ${pathname}. Check if keyword is in title tag, H1, and URL. Small on-page improvements could push to top 10.`,
    };
  }

  // Correct page type but weak position
  if (urlType === "geo-service" || urlType === "service-page") {
    return {
      action: "Optimize Existing",
      suggestion: `Pos ${position.toFixed(0)} from ${pathname}. Page exists but underperforms. Audit: content depth, internal links, local signals, title tag targeting.`,
    };
  }

  // Generic/other page past position 15
  return {
    action: "Create New Page",
    suggestion: `Ranking pos ${position.toFixed(0)} from ${pathname} (${urlType}). A dedicated, keyword-targeted page would likely outperform.`,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const type = req.nextUrl.searchParams.get("type") || "queries";
  const keyword = req.nextUrl.searchParams.get("keyword") || "";

  const property = await prisma.gscProperty.findUnique({
    where: { clientId: id },
  });

  if (!property) {
    return NextResponse.json({ data: [], message: "No GSC property linked" });
  }

  if (type === "pages") {
    const pages = await prisma.gscPage.findMany({
      where: { propertyId: property.id },
      orderBy: { impressions: "desc" },
      take: 200,
    });
    return NextResponse.json({ data: pages });
  }

  if (type === "queries") {
    const queries = await prisma.gscQuery.findMany({
      where: { propertyId: property.id },
      orderBy: { impressions: "desc" },
      take: 100,
    });
    return NextResponse.json({ data: queries });
  }

  if (type === "cannibalization") {
    if (!keyword) {
      return NextResponse.json({ error: "keyword param required for cannibalization check" }, { status: 400 });
    }

    // Find queries matching this keyword (broad match - contains)
    const matches = await prisma.gscQuery.findMany({
      where: {
        propertyId: property.id,
        query: { contains: keyword.toLowerCase(), mode: "insensitive" },
        impressions: { gte: 50 },
      },
      orderBy: { impressions: "desc" },
    });

    // Also search for semantic variants (words in different order, partial matches)
    const keywordWords = keyword.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const variantMatches = await prisma.gscQuery.findMany({
      where: {
        propertyId: property.id,
        impressions: { gte: 50 },
        AND: keywordWords.slice(0, 3).map((word) => ({
          query: { contains: word, mode: "insensitive" as const },
        })),
      },
      orderBy: { impressions: "desc" },
      take: 50,
    });

    // Merge and deduplicate
    const allMatches = new Map<string, typeof matches[0]>();
    for (const m of [...matches, ...variantMatches]) {
      const key = `${m.query}|${m.page}`;
      if (!allMatches.has(key)) allMatches.set(key, m);
    }

    // Group by query
    const queryMap = new Map<string, (typeof matches[0] & { urlType: string })[]>();
    for (const row of allMatches.values()) {
      const urlType = classifyUrl(row.page);
      const existing = queryMap.get(row.query) || [];
      existing.push({ ...row, urlType });
      queryMap.set(row.query, existing);
    }

    const cannibalization: {
      query: string;
      pages: { url: string; avgPosition: number; impressions: number; clicks: number; urlType: string; impressionShare: number }[];
      severity: string;
      suggestion: string;
    }[] = [];

    const existingRanking: {
      query: string;
      page: string;
      avgPosition: number;
      impressions: number;
      clicks: number;
      urlType: string;
      action: string;
      suggestion: string;
      isQuickWin: boolean;
    }[] = [];

    for (const [query, pages] of queryMap) {
      const totalImp = pages.reduce((sum, p) => sum + p.impressions, 0);

      if (pages.length >= 2) {
        const sorted = [...pages].sort((a, b) => a.avgPosition - b.avgPosition);

        // Check if there's actual cannibalization (3-rank proximity)
        let hasCannibalization = false;
        for (let i = 0; i < sorted.length - 1; i++) {
          const gap = Math.abs(sorted[i].avgPosition - sorted[i + 1].avgPosition);
          if (gap <= 5) { // Widened from 3 to 5 to catch more cases
            hasCannibalization = true;
            break;
          }
        }

        if (hasCannibalization || pages.length >= 3) {
          const minShare = Math.min(...pages.map((p) => p.impressions)) / totalImp;
          const severity = pages.length >= 3 ? "HIGH" : minShare > 0.35 ? "HIGH" : minShare > 0.15 ? "MEDIUM" : "LOW";

          cannibalization.push({
            query,
            pages: sorted.map((p) => ({
              url: p.page,
              avgPosition: p.avgPosition,
              impressions: p.impressions,
              clicks: p.clicks,
              urlType: p.urlType,
              impressionShare: Math.round((p.impressions / totalImp) * 100),
            })),
            severity,
            suggestion: generateCannSuggestion(
              sorted.map((p) => ({ url: p.page, avgPosition: p.avgPosition, impressions: p.impressions, urlType: p.urlType })),
              query
            ),
          });
        } else {
          // Multiple pages but no proximity issue - show as ranking with all URLs
          for (const p of pages) {
            const { action, suggestion } = classifyAction(p.page, p.urlType, p.avgPosition, query);
            const isQuickWin = p.avgPosition >= 5 && p.avgPosition <= 30 && p.impressions >= 50
              && !p.page.toLowerCase().includes(keyword.toLowerCase().replace(/\s+/g, "-"));
            existingRanking.push({
              query, page: p.page, avgPosition: p.avgPosition, impressions: p.impressions,
              clicks: p.clicks, urlType: p.urlType, action, suggestion, isQuickWin,
            });
          }
        }
      } else {
        // Single page ranking
        const p = pages[0];
        const { action, suggestion } = classifyAction(p.page, p.urlType, p.avgPosition, query);
        const isQuickWin = p.avgPosition >= 5 && p.avgPosition <= 30 && p.impressions >= 50
          && !p.page.toLowerCase().includes(keyword.toLowerCase().replace(/\s+/g, "-"));
        existingRanking.push({
          query, page: p.page, avgPosition: p.avgPosition, impressions: p.impressions,
          clicks: p.clicks, urlType: p.urlType, action, suggestion, isQuickWin,
        });
      }
    }

    // Sort: cannibalization by severity, rankings by impressions
    cannibalization.sort((a, b) => {
      const sev = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return (sev[a.severity as keyof typeof sev] ?? 3) - (sev[b.severity as keyof typeof sev] ?? 3);
    });
    existingRanking.sort((a, b) => b.impressions - a.impressions);

    return NextResponse.json({ cannibalization, existingRanking });
  }

  return NextResponse.json({ error: "Invalid type. Use: pages, queries, cannibalization" }, { status: 400 });
}
