import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await prisma.researchSession.findUnique({
    where: { id },
    include: {
      client: {
        select: { id: true, name: true, domain: true, da: true, locationId: true, onboardingSummary: true },
      },
      candidates: {
        orderBy: { createdAt: "asc" },
      },
      analyses: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json(session);
}
