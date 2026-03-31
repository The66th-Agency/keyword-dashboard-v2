import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { candidateId } = await req.json();

  await prisma.keywordCandidate.update({
    where: { id: candidateId, sessionId: id },
    data: { status: "skipped" },
  });

  return NextResponse.json({ ok: true });
}
