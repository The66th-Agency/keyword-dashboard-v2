import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isConnected } from "@/lib/gsc";
import { syncGscProperty } from "@/lib/gsc-sync";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const connected = await isConnected();
  if (!connected) {
    return NextResponse.json({ error: "GSC not connected. Visit /api/gsc/auth first." }, { status: 400 });
  }

  // Fire-and-forget sync
  syncGscProperty(id).catch((e) => {
    console.error(`[GSC Sync] Background sync failed for client ${id}:`, e);
  });

  return NextResponse.json({ status: "syncing" });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const connected = await isConnected();
  const property = await prisma.gscProperty.findUnique({
    where: { clientId: id },
  });

  if (!property) {
    return NextResponse.json({
      connected,
      linked: false,
      syncStatus: null,
      lastSyncAt: null,
      pageCount: 0,
      queryCount: 0,
      topQueries: [],
    });
  }

  const [pageCount, queryCount, topQueries] = await Promise.all([
    prisma.gscPage.count({ where: { propertyId: property.id } }),
    prisma.gscQuery.count({ where: { propertyId: property.id } }),
    prisma.gscQuery.findMany({
      where: { propertyId: property.id },
      orderBy: { impressions: "desc" },
      take: 10,
      select: { query: true, impressions: true, clicks: true, avgPosition: true, page: true },
    }),
  ]);

  return NextResponse.json({
    connected,
    linked: true,
    siteUrl: property.siteUrl,
    syncStatus: property.syncStatus,
    syncError: property.syncError,
    lastSyncAt: property.lastSyncAt?.toISOString() || null,
    pageCount,
    queryCount,
    topQueries,
  });
}
