import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listProperties, isConnected } from "@/lib/gsc";

export async function GET() {
  const connected = await isConnected();

  if (!connected) {
    return NextResponse.json({ connected: false, properties: [] });
  }

  const token = await prisma.gscToken.findUnique({ where: { id: "singleton" } });

  try {
    const properties = await listProperties();
    return NextResponse.json({
      connected: true,
      expiresAt: token?.expiresAt?.toISOString() || null,
      properties: properties.map((p) => ({
        siteUrl: p.siteUrl,
        permissionLevel: p.permissionLevel,
      })),
    });
  } catch (e) {
    return NextResponse.json({
      connected: true,
      expiresAt: token?.expiresAt?.toISOString() || null,
      properties: [],
      error: e instanceof Error ? e.message : "Failed to list properties",
    });
  }
}
