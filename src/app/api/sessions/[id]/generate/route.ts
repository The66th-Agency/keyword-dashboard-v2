import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateCandidates } from "@/lib/claude";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await prisma.researchSession.findUnique({
    where: { id },
    include: { client: { include: { pages: true } } },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (!session.client.onboardingSummary) {
    return NextResponse.json({ error: "Client must have an onboarding summary before generating candidates" }, { status: 400 });
  }

  // Set status to generating
  await prisma.researchSession.update({
    where: { id },
    data: { status: "generating_candidates", error: null },
  });

  // Fire-and-forget candidate generation
  generateCandidates({
    onboardingSummary: session.client.onboardingSummary,
    clientDA: session.client.da,
    existingPages: session.client.pages.map((p: { url: string; inferredKeyword: string | null }) => `${p.url}${p.inferredKeyword ? ` (targets: ${p.inferredKeyword})` : ""}`),
    scope: session.scope,
  })
    .then(async (candidates) => {
      // Store candidates
      await prisma.keywordCandidate.createMany({
        data: candidates.map((c) => ({
          sessionId: id,
          keyword: c.keyword,
          rationale: c.rationale,
          funnelStage: c.funnelStage,
          tailLength: c.tailLength || null,
          status: "pending",
        })),
      });

      await prisma.researchSession.update({
        where: { id },
        data: { status: "idle" },
      });

      console.log(`[Generate] ${candidates.length} candidates generated for session ${id}`);
    })
    .catch(async (e) => {
      const errMsg = e instanceof Error ? e.message : "Unknown error";
      await prisma.researchSession.update({
        where: { id },
        data: { status: "idle", error: errMsg },
      });
      console.error(`[Generate] Failed for session ${id}:`, errMsg);
    });

  return NextResponse.json({ status: "generating" });
}
