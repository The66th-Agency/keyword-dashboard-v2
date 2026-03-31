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
      client: { select: { name: true, domain: true, da: true } },
      candidates: {
        where: { status: { in: ["approved", "rejected", "redirected"] } },
        include: { analysis: true },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Load GSC property for ranking context
  const gscProperty = await prisma.gscProperty.findUnique({
    where: { clientId: session.clientId },
  });

  const headers = [
    "Keyword", "Status", "Volume", "KD", "Intent", "Intent Evidence",
    "Service Match", "Service Match Note",
    "Commonalities", "Gaps",
    "Competitor Targeting Score", "Targeting Detail",
    "Semantic Variations",
    "Outline Sections", "Word Count Guidance", "FAQ Suggestions",
    "Confidence", "Flags", "Recommendation",
    "Cannibalization Flags",
    "GSC Ranking Context",
    "Review Note",
  ];

  const rows: string[][] = [];

  for (const candidate of session.candidates) {
    const a = candidate.analysis;
    if (!a) continue;

    // Parse JSON fields
    let compAnalysis: { commonalities?: string; gaps?: string } = {};
    try { compAnalysis = JSON.parse(a.competitiveAnalysis || "{}"); } catch { /* */ }

    let outline: { sections?: { title: string; type: string }[]; wordCountGuidance?: string; faqSuggestions?: string[] } = {};
    try { outline = JSON.parse(a.recommendedOutline || "{}"); } catch { /* */ }

    let confNote: { note?: string; flags?: string[]; recommendation?: string } = {};
    try { confNote = JSON.parse(a.confidenceNote || "{}"); } catch { /* */ }

    let variations: { variation: string; verdict: string }[] = [];
    try { variations = JSON.parse(a.semanticVariations || "[]"); } catch { /* */ }

    // GSC ranking context
    let gscContext = "";
    if (gscProperty) {
      const gscMatches = await prisma.gscQuery.findMany({
        where: {
          propertyId: gscProperty.id,
          query: { contains: a.keyword.toLowerCase(), mode: "insensitive" },
          impressions: { gte: 50 },
        },
        orderBy: { impressions: "desc" },
        take: 5,
      });
      if (gscMatches.length > 0) {
        gscContext = gscMatches.map((q) => `"${q.query}" pos ${q.avgPosition.toFixed(1)} (${q.impressions} imp)`).join("; ");
      }
    }

    // Extract cannibalization flags from confNote.flags
    const cannFlags = (confNote.flags || [])
      .filter((f) => f.toLowerCase().includes("cannibalization") || f.toLowerCase().includes("overlap"))
      .join("; ");

    rows.push([
      a.keyword,
      candidate.status,
      String(a.volume),
      String(a.kd),
      a.intentConfirmation || "",
      a.intentEvidence || "",
      a.serviceMatch || "",
      a.serviceMatchNote || "",
      compAnalysis.commonalities || "",
      compAnalysis.gaps || "",
      a.competitorTargetingScore || "",
      "", // targeting detail is in targetingAssessment JSON, keep simple for now
      variations.map((v) => `${v.variation} (${v.verdict})`).join("; "),
      (outline.sections || []).map((s) => `[${s.type}] ${s.title}`).join("; "),
      outline.wordCountGuidance || "",
      (outline.faqSuggestions || []).join("; "),
      a.confidence,
      (confNote.flags || []).join("; "),
      confNote.recommendation || "",
      cannFlags,
      gscContext,
      candidate.reviewNote || "",
    ]);
  }

  // Build TSV
  const escape = (val: string) => val.replace(/\t/g, " ").replace(/\n/g, " ").replace(/\r/g, "");
  const tsv = [
    headers.join("\t"),
    ...rows.map((row) => row.map(escape).join("\t")),
  ].join("\n");

  const filename = `${session.client.name.replace(/\s+/g, "-").toLowerCase()}-${session.scope.replace(/\s+/g, "-").toLowerCase()}-export.tsv`;

  return new NextResponse(tsv, {
    headers: {
      "Content-Type": "text/tab-separated-values; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
