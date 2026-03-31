import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchSiteProfiler } from "@/lib/mangools";

export async function GET() {
  const clients = await prisma.client.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { sessions: true, pages: true } },
    },
  });
  return NextResponse.json(clients);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, domain } = body;

  if (!name || !domain) {
    return NextResponse.json({ error: "Name and domain are required" }, { status: 400 });
  }

  const client = await prisma.client.create({
    data: { name, domain },
  });

  // Fire-and-forget DA fetch via Mangools Site Profiler
  fetchSiteProfiler(domain)
    .then(async (profile) => {
      await prisma.client.update({
        where: { id: client.id },
        data: { da: profile.da },
      });
      console.log(`[DA Fetch] ${domain} -> DA ${profile.da}`);
    })
    .catch((e) => {
      console.error(`[DA Fetch] Failed for ${domain}:`, e);
    });

  return NextResponse.json(client, { status: 201 });
}
