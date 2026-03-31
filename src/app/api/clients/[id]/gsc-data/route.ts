import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

    // Find queries matching this keyword that appear on 2+ pages
    const matches = await prisma.gscQuery.findMany({
      where: {
        propertyId: property.id,
        query: { contains: keyword.toLowerCase(), mode: "insensitive" },
        impressions: { gte: 50 },
      },
      orderBy: { impressions: "desc" },
    });

    // Group by query, find multi-page queries
    const queryMap = new Map<string, typeof matches>();
    for (const row of matches) {
      const existing = queryMap.get(row.query) || [];
      existing.push(row);
      queryMap.set(row.query, existing);
    }

    const cannibalization: {
      query: string;
      pages: { url: string; avgPosition: number; impressions: number; clicks: number }[];
      severity: string;
    }[] = [];

    const existingRanking: { query: string; page: string; avgPosition: number; impressions: number; clicks: number }[] = [];

    for (const [query, pages] of queryMap) {
      if (pages.length >= 2) {
        // Check 3-rank proximity
        const sorted = [...pages].sort((a, b) => a.avgPosition - b.avgPosition);
        let hasCannibalization = false;

        for (let i = 0; i < sorted.length - 1; i++) {
          const gap = Math.abs(sorted[i].avgPosition - sorted[i + 1].avgPosition);
          if (gap <= 3) {
            const totalImp = sorted[i].impressions + sorted[i + 1].impressions;
            const minShare = Math.min(sorted[i].impressions, sorted[i + 1].impressions) / totalImp;
            const severity = minShare > 0.35 ? "HIGH" : minShare > 0.15 ? "MEDIUM" : "LOW";

            cannibalization.push({
              query,
              pages: sorted.map((p) => ({
                url: p.page,
                avgPosition: p.avgPosition,
                impressions: p.impressions,
                clicks: p.clicks,
              })),
              severity,
            });
            hasCannibalization = true;
            break;
          }
        }

        if (!hasCannibalization) {
          // Multiple pages but no proximity issue - still show as existing ranking
          for (const p of pages) {
            existingRanking.push({
              query, page: p.page, avgPosition: p.avgPosition, impressions: p.impressions, clicks: p.clicks,
            });
          }
        }
      } else {
        // Single page ranking - existing ranking context
        const p = pages[0];
        existingRanking.push({
          query, page: p.page, avgPosition: p.avgPosition, impressions: p.impressions, clicks: p.clicks,
        });
      }
    }

    return NextResponse.json({ cannibalization, existingRanking });
  }

  return NextResponse.json({ error: "Invalid type. Use: pages, queries, cannibalization" }, { status: 400 });
}
