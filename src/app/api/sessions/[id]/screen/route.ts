import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchKeywordImports } from "@/lib/mangools";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await prisma.researchSession.findUnique({
    where: { id },
    include: {
      client: { select: { da: true, locationId: true, languageId: true } },
      candidates: { where: { status: "selected" } },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.candidates.length === 0) {
    return NextResponse.json({ error: "No selected candidates to screen" }, { status: 400 });
  }

  const keywords = session.candidates.map((c) => c.keyword);

  try {
    const results = await fetchKeywordImports(
      keywords,
      session.client.locationId,
      session.client.languageId
    );

    // Build a map for quick lookup
    const volumeMap = new Map(results.map((r) => [r.keyword.toLowerCase(), r]));

    // Update each candidate with volume + kd
    const updates = await Promise.all(
      session.candidates.map(async (candidate) => {
        const data = volumeMap.get(candidate.keyword.toLowerCase());
        const volume = data?.volume ?? 0;
        const kd = data?.kd ?? 0;

        await prisma.keywordCandidate.update({
          where: { id: candidate.id },
          data: { volume, kd },
        });

        const zeroVolumeWarning =
          volume === 0 && session.client.da > 5
            ? `Zero volume with DA ${session.client.da} - not recommended`
            : null;

        return {
          id: candidate.id,
          keyword: candidate.keyword,
          volume,
          kd,
          zeroVolumeWarning,
        };
      })
    );

    const warnings = updates.filter((u) => u.zeroVolumeWarning);

    return NextResponse.json({
      screened: updates,
      warningCount: warnings.length,
      clientDA: session.client.da,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Volume screen failed: ${e instanceof Error ? e.message : "unknown"}` },
      { status: 500 }
    );
  }
}
