import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

interface ReviewItem {
  candidateId: string;
  analysisId: string;
  decision: "approved" | "rejected" | "redirected";
  note?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { reviews } = body as { reviews: ReviewItem[] };

  if (!reviews || !Array.isArray(reviews) || reviews.length === 0) {
    return NextResponse.json({ error: "reviews array is required" }, { status: 400 });
  }

  // Process each review
  for (const review of reviews) {
    // Update candidate status
    await prisma.keywordCandidate.update({
      where: { id: review.candidateId },
      data: {
        status: review.decision,
        reviewNote: review.note || null,
      },
    });

    // Update analysis review status
    await prisma.keywordAnalysis.update({
      where: { id: review.analysisId },
      data: {
        reviewStatus: review.decision,
        reviewNote: review.note || null,
      },
    });
  }

  // Check if scope is met
  const session = await prisma.researchSession.findUnique({
    where: { id },
    include: {
      candidates: { where: { status: "approved" } },
    },
  });

  // Parse scope target (e.g. "10 BOF keywords" -> 10)
  const scopeMatch = session?.scope.match(/(\d+)/);
  const scopeTarget = scopeMatch ? parseInt(scopeMatch[1]) : 0;
  const approvedCount = session?.candidates.length || 0;

  if (approvedCount >= scopeTarget && scopeTarget > 0) {
    await prisma.researchSession.update({
      where: { id },
      data: { status: "completed" },
    });
  }

  return NextResponse.json({
    reviewed: reviews.length,
    approvedTotal: approvedCount,
    scopeTarget,
    completed: approvedCount >= scopeTarget && scopeTarget > 0,
  });
}
