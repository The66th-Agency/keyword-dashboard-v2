import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { candidateIds } = body as { candidateIds: string[] };

  if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
    return NextResponse.json({ error: "candidateIds array is required" }, { status: 400 });
  }

  // Verify candidates belong to this session
  const candidates = await prisma.keywordCandidate.findMany({
    where: { id: { in: candidateIds }, sessionId: id },
  });

  if (candidates.length !== candidateIds.length) {
    return NextResponse.json({ error: "Some candidate IDs are invalid or don't belong to this session" }, { status: 400 });
  }

  // Mark selected
  await prisma.keywordCandidate.updateMany({
    where: { id: { in: candidateIds } },
    data: { status: "selected" },
  });

  // Mark unselected pending candidates as skipped
  await prisma.keywordCandidate.updateMany({
    where: { sessionId: id, status: "pending", id: { notIn: candidateIds } },
    data: { status: "skipped" },
  });

  return NextResponse.json({ selected: candidates.length });
}
