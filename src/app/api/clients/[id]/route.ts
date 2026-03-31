import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      pages: { orderBy: { lastScanned: "desc" } },
      sessions: {
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { candidates: true, analyses: true } },
          candidates: {
            where: { status: "approved" },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  return NextResponse.json(client);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { name, domain, da, sitemapUrl, locationId, languageId } = body;

  const client = await prisma.client.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(domain !== undefined && { domain }),
      ...(da !== undefined && { da }),
      ...(sitemapUrl !== undefined && { sitemapUrl }),
      ...(locationId !== undefined && { locationId }),
      ...(languageId !== undefined && { languageId }),
    },
  });

  return NextResponse.json(client);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.client.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
