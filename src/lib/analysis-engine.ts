import { prisma } from "./prisma";
import { fetchSerp, fetchRelatedKeywords, fetchKeywordImports } from "./mangools";
import { fetchPageContent } from "./content-fetcher";
import {
  analyzeCompetitiveContext,
  analyzeCompetitiveContextViaWebSearch,
  validateServiceAndStructure,
  selfValidate,
  type CompetitiveAnalysisOutput,
  type ServiceValidationOutput,
} from "./claude";

/**
 * Run deep analysis for a batch of selected candidates.
 * Called fire-and-forget from the API route.
 * Updates KeywordAnalysis records as each step completes.
 */
export async function runBatchAnalysis(sessionId: string) {
  const session = await prisma.researchSession.findUnique({
    where: { id: sessionId },
    include: {
      client: true,
      candidates: {
        where: { status: "selected" },
        include: { analysis: true },
      },
    },
  });

  if (!session) throw new Error("Session not found");

  const client = session.client;
  const onboardingSummary = client.onboardingSummary || "{}";

  // Get existing pages for cannibalization check
  const existingPages = await prisma.existingPage.findMany({
    where: { clientId: client.id },
  });

  // Get all approved keywords across ALL sessions for this client (cannibalization)
  const approvedKeywords = await prisma.keywordCandidate.findMany({
    where: {
      session: { clientId: client.id },
      status: "approved",
    },
    select: { keyword: true },
  });

  try {
    // Process each selected candidate sequentially (Mangools rate limit)
    for (const candidate of session.candidates) {
      // Create or get analysis record
      let analysis = candidate.analysis;
      if (!analysis) {
        analysis = await prisma.keywordAnalysis.create({
          data: {
            candidateId: candidate.id,
            sessionId: session.id,
            keyword: candidate.keyword,
            status: "fetching_serp",
          },
        });
      }

      try {
        // Pass screened volume/kd from candidate (already fetched via keyword-imports during screen step)
        // -1 means not yet screened - fall back to re-fetching
        const screenedVolume = candidate.volume >= 0 ? candidate.volume : undefined;
        const screenedKd = candidate.kd >= 0 ? candidate.kd : undefined;
        await analyzeKeyword(analysis.id, candidate.keyword, client, onboardingSummary, existingPages, approvedKeywords, screenedVolume, screenedKd);

        // Mark candidate as analyzed
        await prisma.keywordCandidate.update({
          where: { id: candidate.id },
          data: { status: "analyzed" },
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "Unknown error";
        await prisma.keywordAnalysis.update({
          where: { id: analysis.id },
          data: { status: "failed", error: errMsg },
        });
        console.error(`Analysis failed for "${candidate.keyword}":`, errMsg);
      }
    }

    // Update session status
    await prisma.researchSession.update({
      where: { id: sessionId },
      data: { status: "idle" },
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Unknown error";
    await prisma.researchSession.update({
      where: { id: sessionId },
      data: { status: "idle", error: errMsg },
    });
  }
}

async function analyzeKeyword(
  analysisId: string,
  keyword: string,
  client: { id: string; da: number; locationId: number; languageId: number; domain: string },
  onboardingSummary: string,
  existingPages: { url: string; title: string | null; inferredKeyword: string | null }[],
  approvedKeywords: { keyword: string }[],
  screenedVolume?: number,
  screenedKd?: number
) {
  // Step 1: Mangools SERP (with web search fallback on 500)
  await prisma.keywordAnalysis.update({
    where: { id: analysisId },
    data: { status: "fetching_serp" },
  });

  let serpResult: Awaited<ReturnType<typeof fetchSerp>>;
  let serpUnavailable = false;

  try {
    serpResult = await fetchSerp(keyword, client.locationId, client.languageId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("500") || msg.includes("No available SERP provider")) {
      console.log(`[SERP] Mangools unavailable for "${keyword}", will use web search fallback`);
      serpUnavailable = true;
      serpResult = { keyword, volume: 0, kd: 0, items: [], rawResponse: "" };
    } else {
      throw e;
    }
  }

  // Use screened volume/kd from candidate if available (fetched during screen step)
  // Only re-fetch if the screen step was skipped (-1 default)
  let volume = screenedVolume ?? 0;
  let kd = screenedKd ?? serpResult.kd;

  if (screenedVolume === undefined) {
    try {
      const importResults = await fetchKeywordImports([keyword], client.locationId, client.languageId);
      const match = importResults.find((r) => r.keyword.toLowerCase() === keyword.toLowerCase());
      if (match) {
        volume = match.volume;
        kd = match.kd || kd;
      }
      console.log(`[Volume] "${keyword}" -> ${volume} (re-fetched via keyword-imports)`);
    } catch (e) {
      console.error(`[Volume] keyword-imports failed for "${keyword}":`, e);
    }
  } else {
    console.log(`[Volume] "${keyword}" -> ${volume} (from screen step)`);
  }

  await prisma.keywordAnalysis.update({
    where: { id: analysisId },
    data: {
      volume,
      kd,
      mangoolsRawSerpResponse: serpResult.rawResponse,
    },
  });

  // Step 2: Fetch top 3 competitor pages
  await prisma.keywordAnalysis.update({
    where: { id: analysisId },
    data: { status: "fetching_pages" },
  });

  const topUrls = serpResult.items.slice(0, 3).map((i) => i.url).filter(Boolean);
  const competitorPages = await Promise.all(topUrls.map((url) => fetchPageContent(url)));

  const blockedCount = competitorPages.filter((p) => p.blocked).length;
  const allBlocked = blockedCount === competitorPages.length;
  const someBlocked = blockedCount > 0;

  console.log(`[Pages] "${keyword}" -> ${competitorPages.length - blockedCount}/${competitorPages.length} fetched, ${blockedCount} blocked`);

  // Build targeting assessment (only for non-blocked pages)
  const keywordLower = keyword.toLowerCase();
  const targetingAssessment = competitorPages
    .filter((p) => !p.blocked)
    .map((page) => ({
      url: page.url,
      keywordInTitle: page.title.toLowerCase().includes(keywordLower),
      keywordInH1: page.h1.toLowerCase().includes(keywordLower),
      keywordInUrl: page.url.toLowerCase().includes(keywordLower.replace(/\s+/g, "-")),
      keywordInFirstParagraph: page.bodySnippet.slice(0, 500).toLowerCase().includes(keywordLower),
    }));

  await prisma.keywordAnalysis.update({
    where: { id: analysisId },
    data: {
      serpCompetitors: JSON.stringify(
        competitorPages.map((p, i) => ({
          ...p,
          da: serpResult.items[i]?.da || 0,
          position: serpResult.items[i]?.position || 0,
        }))
      ),
      targetingAssessment: JSON.stringify(targetingAssessment),
    },
  });

  // Step 3: Claude Pass 1 - Competitive Analysis
  await prisma.keywordAnalysis.update({
    where: { id: analysisId },
    data: { status: "analyzing" },
  });

  let competitiveAnalysis: CompetitiveAnalysisOutput;
  let pagesSource: "direct" | "web_search" | "partial";

  if (serpUnavailable || allBlocked) {
    // Mangools SERP unavailable OR all pages blocked - fall back to web search
    console.log(`[Analysis] "${keyword}" - ${serpUnavailable ? "SERP unavailable" : "all pages blocked"}, falling back to web search`);
    pagesSource = "web_search";
    competitiveAnalysis = await analyzeCompetitiveContextViaWebSearch({
      keyword,
      serpUrls: serpResult.items.slice(0, 3),
      onboardingSummary,
      clientDA: client.da,
    });
  } else {
    // At least some pages fetched directly
    pagesSource = someBlocked ? "partial" : "direct";
    competitiveAnalysis = await analyzeCompetitiveContext({
      keyword,
      serpData: serpResult.items.slice(0, 5),
      competitorPages: competitorPages.filter((p) => !p.blocked),
      targetingAssessment,
      onboardingSummary,
      clientDA: client.da,
    });
  }

  await prisma.keywordAnalysis.update({
    where: { id: analysisId },
    data: {
      intentConfirmation: competitiveAnalysis.intentConfirmation,
      intentEvidence: competitiveAnalysis.intentEvidence,
      competitiveAnalysis: JSON.stringify({
        commonalities: competitiveAnalysis.commonalities,
        gaps: competitiveAnalysis.gaps,
        pagesSource,
        blockedCount,
        totalPages: competitorPages.length,
      }),
      competitorTargetingScore: competitiveAnalysis.competitorTargetingScore,
    },
  });

  // Step 4: Claude Pass 2 - Service Validation + Page Structure
  const serviceValidation: ServiceValidationOutput = await validateServiceAndStructure({
    keyword,
    onboardingSummary,
    competitiveAnalysis,
  });

  await prisma.keywordAnalysis.update({
    where: { id: analysisId },
    data: {
      serviceMatch: serviceValidation.serviceMatch,
      serviceMatchNote: serviceValidation.serviceMatchNote,
      recommendedOutline: JSON.stringify(serviceValidation.recommendedOutline),
    },
  });

  // Step 5: Semantic variation SERP overlap check (Mangools related keywords)
  let semanticVariations: { variation: string; overlapDomains: string[]; verdict: string }[] = [];
  try {
    const relatedKws = await fetchRelatedKeywords(keyword, client.locationId, client.languageId);

    // Filter to true semantic variations: must share at least 2 words with the primary keyword
    // This excludes branded terms, unrelated queries, etc.
    const primaryWords = new Set(keyword.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    const variations = relatedKws
      .filter((rk) => {
        if (rk.keyword.toLowerCase() === keyword.toLowerCase()) return false;
        const varWords = rk.keyword.toLowerCase().split(/\s+/);
        const sharedWords = varWords.filter((w) => primaryWords.has(w));
        return sharedWords.length >= 2;
      })
      .slice(0, 2);

    console.log(`[Semantic] "${keyword}" -> ${variations.length} filtered variations from ${relatedKws.length} related`);

    for (const variation of variations) {
      const varSerp = await fetchSerp(variation.keyword, client.locationId, client.languageId);

      // Compare top 5 domains
      const primaryDomains = serpResult.items.slice(0, 5).map((i) => extractDomain(i.url));
      const variationDomains = varSerp.items.slice(0, 5).map((i) => extractDomain(i.url));
      const overlapDomains = primaryDomains.filter((d) => variationDomains.includes(d));

      semanticVariations.push({
        variation: variation.keyword,
        overlapDomains,
        verdict: overlapDomains.length >= 3 ? "secondary" : "separate",
      });
    }
  } catch (e) {
    console.error("Semantic variation check failed:", e);
    // Non-fatal - continue with analysis
  }

  await prisma.keywordAnalysis.update({
    where: { id: analysisId },
    data: { semanticVariations: JSON.stringify(semanticVariations) },
  });

  // Step 6: Cannibalization check
  const cannibalizationFlags: string[] = [];

  // Check against existing pages
  for (const page of existingPages) {
    if (
      page.inferredKeyword?.toLowerCase().includes(keywordLower) ||
      page.url.toLowerCase().includes(keywordLower.replace(/\s+/g, "-"))
    ) {
      cannibalizationFlags.push(`Potential overlap with existing page: ${page.url}`);
    }
  }

  // Check against approved keywords from all sessions
  for (const approved of approvedKeywords) {
    if (approved.keyword.toLowerCase() === keywordLower) {
      cannibalizationFlags.push(`Exact match with previously approved keyword: "${approved.keyword}"`);
    }
    // Check semantic similarity via word overlap
    const approvedWords = new Set(approved.keyword.toLowerCase().split(/\s+/));
    const currentWords = keywordLower.split(/\s+/);
    const overlap = currentWords.filter((w) => approvedWords.has(w)).length;
    if (overlap >= 2 && approved.keyword.toLowerCase() !== keywordLower) {
      cannibalizationFlags.push(`High word overlap with approved keyword: "${approved.keyword}"`);
    }
  }

  // Step 7: Claude Pass 3 - Self-Validation
  const validation = await selfValidate({
    keyword,
    volume: serpResult.volume,
    kd: serpResult.kd,
    clientDA: client.da,
    competitiveAnalysis,
    serviceValidation,
    semanticVariations,
    onboardingSummary,
  });

  // Merge cannibalization flags into validation flags
  const allFlags = [...validation.flags, ...cannibalizationFlags];

  await prisma.keywordAnalysis.update({
    where: { id: analysisId },
    data: {
      confidence: validation.confidence,
      confidenceNote: JSON.stringify({
        note: validation.confidenceNote,
        flags: allFlags,
        recommendation: validation.recommendation,
      }),
      status: "complete",
    },
  });
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
