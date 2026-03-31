import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateOnboardingSummary } from "@/lib/claude";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { content } = body;

  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "Content is required (string)" }, { status: 400 });
  }

  // Store raw doc immediately
  await prisma.client.update({
    where: { id },
    data: { onboardingDoc: content, onboardingSummary: null },
  });

  // Fire-and-forget: generate summary with Claude Sonnet
  generateOnboardingSummary(content)
    .then(async (summary) => {
      await prisma.client.update({
        where: { id },
        data: { onboardingSummary: summary },
      });
      console.log(`[Onboarding] Summary generated for client ${id}`);
    })
    .catch((e) => {
      console.error(`[Onboarding] Summary generation failed for client ${id}:`, e);
    });

  return NextResponse.json({ status: "processing", message: "Document uploaded, summary generating..." });
}
