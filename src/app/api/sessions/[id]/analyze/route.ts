import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runBatchAnalysis } from "@/lib/analysis-engine";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await prisma.researchSession.findUnique({
    where: { id },
    include: {
      candidates: { where: { status: "selected" } },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.candidates.length === 0) {
    return NextResponse.json({ error: "No candidates selected for analysis" }, { status: 400 });
  }

  // Set status
  await prisma.researchSession.update({
    where: { id },
    data: { status: "analyzing_batch", error: null },
  });

  // Fire-and-forget batch analysis
  runBatchAnalysis(id).catch((e) => {
    console.error(`[Analyze] Batch analysis failed for session ${id}:`, e);
  });

  return NextResponse.json({ status: "analyzing", count: session.candidates.length });
}
