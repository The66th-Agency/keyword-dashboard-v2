import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const client = await prisma.client.findUnique({ where: { id } });

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  // Check if manual URLs were pasted
  let body: { urls?: string[] } = {};
  try { body = await req.json(); } catch { /* no body = sitemap scan */ }

  if (body.urls && body.urls.length > 0) {
    const urls = body.urls.filter((u) => u.startsWith("http"));
    if (urls.length === 0) {
      return NextResponse.json({ error: "No valid URLs found (must start with http)" }, { status: 400 });
    }
    await prisma.existingPage.deleteMany({ where: { clientId: id } });
    const pages = await prisma.existingPage.createMany({
      data: urls.map((url) => ({
        clientId: id,
        url,
        title: extractTitleFromUrl(url),
        inferredKeyword: inferKeywordFromUrl(url),
      })),
    });
    return NextResponse.json({ count: pages.count });
  }

  // Sitemap scan path
  const sitemapUrl = client.sitemapUrl || `https://${client.domain}/sitemap.xml`;

  try {
    const res = await fetch(sitemapUrl, {
      headers: { "User-Agent": "The66th-SEO-Tool/1.0" },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Sitemap returned ${res.status}. Try setting a custom sitemap URL in client settings, or use Paste URLs.` },
        { status: 400 }
      );
    }

    const xml = await res.text();
    const urlMatches = xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi);
    const urls: string[] = [];
    for (const match of urlMatches) {
      const url = match[1].trim();
      if (url.startsWith("http")) urls.push(url);
    }

    if (urls.length === 0) {
      return NextResponse.json(
        { error: "Sitemap fetched but no URLs found. It may be a sitemap index. Try Paste URLs instead." },
        { status: 400 }
      );
    }

    await prisma.existingPage.deleteMany({ where: { clientId: id } });
    const pages = await prisma.existingPage.createMany({
      data: urls.map((url) => ({
        clientId: id,
        url,
        title: extractTitleFromUrl(url),
        inferredKeyword: inferKeywordFromUrl(url),
      })),
    });

    return NextResponse.json({ count: pages.count });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json(
      { error: `Sitemap fetch failed: ${msg}. Try setting a custom sitemap URL or use Paste URLs.` },
      { status: 500 }
    );
  }
}

function extractTitleFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const slug = path.split("/").filter(Boolean).pop() || "";
    return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return "";
  }
}

function inferKeywordFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const slug = path.split("/").filter(Boolean).pop() || "";
    return slug.replace(/-/g, " ").toLowerCase();
  } catch {
    return "";
  }
}
