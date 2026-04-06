import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const MODEL = "claude-sonnet-4-6" as const;

export async function claudeMessage(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 4096
): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock?.text || "";
}

export async function generateOnboardingSummary(rawDoc: string): Promise<string> {
  const system = `You are an SEO research assistant. Extract structured information from a client onboarding document. Return valid JSON only, no markdown fences.`;

  const prompt = `Extract the following from this onboarding document and return as JSON:

{
  "business_name": "",
  "services": ["list of services offered"],
  "locations": ["cities/regions served"],
  "service_geography": "local | regional | national | international",
  "icps": ["ideal customer profiles"],
  "competitors": ["competitor names/domains"],
  "brand_voice": "",
  "guardrails": ["things to avoid, restrictions"],
  "differentiators": ["unique selling points"],
  "additional_context": ""
}

Onboarding document:
${rawDoc}`;

  return claudeMessage(system, prompt, 2048);
}

export interface CandidateOutput {
  keyword: string;
  rationale: string;
  funnelStage: string;
  icp?: string;
  icpInferred?: boolean;
}

/**
 * Parse multi-funnel scope strings into per-funnel targets.
 * Supports: "10 BOF, 5 MOF, 5 TOF" | "20 keywords" | "15 BOF"
 * Returns total generate target (capped at 50) and a description for the prompt.
 */
function parseScope(scope: string): { generateTarget: number; scopeDescription: string } {
  // Try multi-funnel format: "10 BOF, 5 MOF, 5 TOF"
  const funnelPattern = /(\d+)\s*(BOF|MOF|TOF)/gi;
  const funnelMatches = [...scope.matchAll(funnelPattern)];

  if (funnelMatches.length > 1) {
    // Multi-funnel scope
    const parts: string[] = [];
    let totalScope = 0;
    for (const m of funnelMatches) {
      const count = parseInt(m[1]);
      const stage = m[2].toUpperCase();
      totalScope += count;
      parts.push(`${count} ${stage}`);
    }
    const generateTarget = Math.min(totalScope * 5, 50);
    // Distribute proportionally
    const breakdown = funnelMatches.map((m) => {
      const count = parseInt(m[1]);
      const stage = m[2].toUpperCase();
      const share = Math.round((count / totalScope) * generateTarget);
      return `~${share} ${stage}`;
    }).join(", ");
    return {
      generateTarget,
      scopeDescription: `Generate ${generateTarget} total candidates (${breakdown}). Scope: ${parts.join(", ")}.`,
    };
  }

  // Single funnel or generic: "10 BOF keywords" or "20 keywords"
  const numMatch = scope.match(/(\d+)/);
  const scopeTarget = numMatch ? parseInt(numMatch[1]) : 10;
  const generateTarget = Math.min(scopeTarget * 5, 50);

  // Check if a specific funnel is mentioned
  const singleFunnel = scope.match(/\b(BOF|MOF|TOF)\b/i);
  if (singleFunnel) {
    return {
      generateTarget,
      scopeDescription: `Generate ${generateTarget} ${singleFunnel[1].toUpperCase()} candidates (5x the scope target of ${scopeTarget}, capped at 50).`,
    };
  }

  // Generic "20 keywords" - auto-balance 50/30/20
  const bof = Math.round(generateTarget * 0.5);
  const mof = Math.round(generateTarget * 0.3);
  const tof = generateTarget - bof - mof;
  return {
    generateTarget,
    scopeDescription: `Generate ${generateTarget} candidates auto-balanced: ~${bof} BOF, ~${mof} MOF, ~${tof} TOF (5x scope of ${scopeTarget}, capped at 50).`,
  };
}

export async function generateCandidates(params: {
  onboardingSummary: string;
  clientDA: number;
  existingPages: string[];
  scope: string;
  gscTopQueries?: { query: string; clicks: number; impressions: number; avgPosition: number; page: string }[];
}): Promise<CandidateOutput[]> {
  const daGuidance =
    params.clientDA <= 5 ? "Focus on zero/very low volume long-tail keywords. Topical authority play from scratch." :
    params.clientDA <= 15 ? "Target 10-200 volume keywords. Long-tail focus. Avoid competitive head terms." :
    params.clientDA <= 30 ? "Mix of long-tail and mid-tail. Some moderate competition viable." :
    params.clientDA <= 50 ? "Competitive keywords viable. Can target mid-range terms with confidence." :
    "No cap on competitiveness. Can pursue high-volume head terms.";

  const system = `You are an expert SEO keyword researcher for The 66th, an SEO agency. You suggest keyword candidates based on deep understanding of the client's business, their domain authority, and search intent.

Rules:
- ONLY suggest keywords for services the client actually offers (check the onboarding summary)
- Consider the client's DA when suggesting keywords. DA ${params.clientDA} means: ${daGuidance}
- Do NOT suggest keywords that already have pages (see existing pages list)
- Provide a specific rationale for each keyword - what makes it a real opportunity, not generic filler

Geography rules:
- Check the onboarding summary "service_geography" field to determine if this is a local or national/SaaS client
- For LOCAL businesses: include city/region IN the keyword itself (e.g. "roof cleaning Vancouver"). Mangools filters by country, not city, so the city must be in the keyword.
- For NATIONAL/SaaS businesses: broader keywords without geo modifiers. Filter by "anywhere."

Funnel stage rules - label each candidate BOF, MOF, or TOF:
- BOF (bottom of funnel): service pages, location pages, product pages. Direct purchase/hire intent. Patterns: "[service] [location]", "[service] near me", "[service] cost [location]", "[product] [category]"
- MOF (middle of funnel): listicles, comparisons, cost/pricing content. Evaluation intent. Patterns: "best [category]", "[brand] vs [brand]", "[service] cost", "top [n] [category]", "[competitor] alternative"
- TOF (top of funnel): how-to guides, educational content, seasonal/topical. Informational intent. Patterns: "how to [problem]", "what is [concept]", "[topic] guide", "when to [action]"

Keyword format rules:
- BOF candidates: service + location format. Short, searchable. Keep what works (e.g. "roof cleaning vancouver", "commercial pressure washing burnaby").
- MOF and TOF candidates: generate SHORT, SEARCHABLE keywords that someone would actually type into Google or Mangools. 2-4 words max. No article titles, no question formats, no year tags, no "ultimate guide to" fluff. The analysis phase will suggest full page titles later. Think search queries, not headlines. Examples: "best pressure washers", "deck staining cost", "how to clean gutters" - NOT "The Ultimate Guide to Gutter Cleaning in 2026".

ICP (ideal customer profile) rules:
- If the onboarding doc lists multiple ICPs, tag each candidate with the most relevant ICP name. If a keyword is ICP-agnostic, leave icp as null.
- For LOCAL businesses: lean toward Location OR ICP as the keyword modifier, not both stacked. Don't put city + persona into one keyword.
- For NATIONAL/SaaS businesses: ICP modifiers are fair game alongside feature/product terms (e.g. "project management for agencies").
- If you tag a candidate with an ICP that is NOT explicitly listed in the onboarding doc (you inferred it), set icpInferred to true. This flags it for human confirmation.

Return valid JSON array only, no markdown fences:
[{"keyword": "", "rationale": "", "funnelStage": "BOF|MOF|TOF", "icp": "string or null", "icpInferred": false}]`;

  const { generateTarget, scopeDescription } = parseScope(params.scope);

  const prompt = `Client onboarding summary:
${params.onboardingSummary}

Client DA: ${params.clientDA}

Existing client pages (do NOT suggest keywords these already target):
${params.existingPages.length > 0 ? params.existingPages.join("\n") : "No existing pages found"}
${params.gscTopQueries && params.gscTopQueries.length > 0 ? `
Google Search Console data (what this site currently ranks for in Google):
${params.gscTopQueries.slice(0, 50).map((q) => `"${q.query}" — pos ${q.avgPosition.toFixed(1)}, ${q.impressions} imp, ${q.clicks} clicks (${q.page})`).join("\n")}

Use this GSC data to:
1. AVOID suggesting keywords the client already ranks well for (position < 10)
2. FIND gap opportunities: queries with high impressions but poor position (> 20) - these are push-to-page-1 candidates
3. IDENTIFY cluster opportunities: related queries the client ranks for that could anchor new content
` : ""}
Scope: ${params.scope}

${scopeDescription} The human reviews all candidates and selects the best ones before any Mangools research runs, so give them plenty of range. Be specific and non-obvious. Think like the client's ideal customer at different stages of awareness.`;

  const response = await claudeMessage(system, prompt, 6144);

  try {
    return JSON.parse(response);
  } catch {
    // Try to extract JSON from response if wrapped in text
    const match = response.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Failed to parse candidate response: " + response.slice(0, 200));
  }
}

export interface CompetitiveAnalysisOutput {
  intentConfirmation: string;
  intentEvidence: string;
  commonalities: string;
  gaps: string;
  competitorTargetingScore: string;
  competitorTargetingDetail: string;
}

/**
 * Fallback competitive analysis using Claude's web_search tool.
 * Used when direct page fetching is blocked (Cloudflare, 403, etc.).
 * Results should be human-validated.
 */
export async function analyzeCompetitiveContextViaWebSearch(params: {
  keyword: string;
  serpUrls: { url: string; da: number; position: number }[];
  onboardingSummary: string;
  clientDA: number;
}): Promise<CompetitiveAnalysisOutput> {
  const system = `You are an expert SEO analyst. Use web search to research the top ranking pages for a keyword, then provide a structured competitive analysis. Return valid JSON only, no markdown fences.`;

  const urlList = params.serpUrls.slice(0, 3).map((s) => `#${s.position}: ${s.url} (DA ${s.da})`).join("\n");

  const prompt = `Keyword: "${params.keyword}"
Client DA: ${params.clientDA}

Top ranking URLs (search for these pages to understand their content, structure, and targeting):
${urlList}

Client context:
${params.onboardingSummary}

Use web search to look up each ranking URL and analyze what they actually contain. Focus on:
1. What type of pages are these (product pages, blog posts, service pages, homepages)? This determines intent.
2. Is the exact keyword "${params.keyword}" in their title, H1, URL slug, first paragraph?
3. What content do they all have in common?
4. What is missing that a well-optimised page should have?

Intent classification rules (apply strictly based on what ACTUALLY ranks):
- BOF: product pages, service pages, collection/category pages, shop pages, homepages with buy CTAs, e-commerce PDPs — anything where the primary action is purchase or hire
- MOF: listicles ("best X", "top X"), comparison pages ("[A] vs [B]", "[competitor] alternative"), review roundups — anything where the searcher is evaluating options
- TOF: how-to guides, educational blog posts, informational articles — anything answering "what is" or "how to"
The page TYPE determines intent, not how "browse-y" the query feels. A collection page is BOF even if the buyer is still choosing between products.

Return JSON with SHORT bullet-point style values (max 2 sentences per field, use dashes for lists):
{
  "intentConfirmation": "BOF|MOF|TOF",
  "intentEvidence": "1-2 sentences on what page types rank and why that confirms the intent",
  "commonalities": "bullet list: - point 1\\n- point 2\\n- point 3 (max 5 bullets, each under 15 words)",
  "gaps": "bullet list: - GAP NAME: one sentence explanation\\n- GAP NAME: one sentence (max 6 gaps)",
  "competitorTargetingScore": "none|partial|direct",
  "competitorTargetingDetail": "1 sentence: who targets it and how, or why nobody does"
}`;

  // web_search is a server-side tool requiring the beta header.
  // The SDK handles tool execution internally - we get back the final response in one call.
  // We need to loop: send tool results back until stop_reason is "end_turn".
  const messages: MessageParam[] = [{ role: "user", content: prompt }];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const response = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 4096,
        system,
        tools: [{ type: "web_search_20250305" as const, name: "web_search" }],
        messages,
      },
      { headers: { "anthropic-beta": "web-search-2025-03-05" } }
    );

    console.log("[WebSearch] stop_reason:", response.stop_reason, "content blocks:", response.content.length);

    if (response.stop_reason === "end_turn") {
      // Extract JSON from all text blocks combined
      const allText = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("\n");

      console.log("[WebSearch] Final text (first 300):", allText.slice(0, 300));

      try {
        return JSON.parse(allText);
      } catch {
        const match = allText.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error("Failed to parse web-search competitive analysis: " + allText.slice(0, 200));
      }
    }

    // stop_reason === "tool_use" - send tool results back and continue
    messages.push({ role: "assistant", content: response.content });

    const toolResults: ToolResultBlockParam[] = response.content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({
        type: "tool_result" as const,
        tool_use_id: (b as ToolUseBlock).id,
        content: "Search executed by server.",
      }));

    if (toolResults.length === 0) break; // safety - no tool uses but not end_turn
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error("Web search loop ended without end_turn");
}

export async function analyzeCompetitiveContext(params: {
  keyword: string;
  serpData: { url: string; da: number; title: string; position: number }[];
  competitorPages: { url: string; title: string; h1: string; h2s: string[]; meta: string; bodySnippet: string }[];
  targetingAssessment: { url: string; keywordInTitle: boolean; keywordInH1: boolean; keywordInUrl: boolean; keywordInFirstParagraph: boolean }[];
  onboardingSummary: string;
  clientDA: number;
}): Promise<CompetitiveAnalysisOutput> {
  const system = `You are an expert SEO analyst. Analyze SERP competitors for a keyword and provide actionable insights. Return valid JSON only, no markdown fences.`;

  const prompt = `Keyword: "${params.keyword}"
Client DA: ${params.clientDA}

SERP results (top positions):
${params.serpData.map((s) => `#${s.position}: ${s.title} (${s.url}) - DA ${s.da}`).join("\n")}

Competitor page content analysis:
${params.competitorPages
  .map(
    (p) => `
URL: ${p.url}
Title: ${p.title}
H1: ${p.h1}
H2s: ${p.h2s.join(", ")}
Meta: ${p.meta}
Content preview: ${p.bodySnippet.slice(0, 500)}
`
  )
  .join("\n---\n")}

Targeting assessment (is the exact keyword "${params.keyword}" present?):
${params.targetingAssessment
  .map((t) => `${t.url}: title=${t.keywordInTitle}, H1=${t.keywordInH1}, URL=${t.keywordInUrl}, first_para=${t.keywordInFirstParagraph}`)
  .join("\n")}

Client context:
${params.onboardingSummary}

Intent classification rules (apply strictly based on what ACTUALLY ranks):
- BOF: product pages, service pages, collection/category pages, shop pages, homepages with buy CTAs, e-commerce PDPs — anything where the primary action is purchase or hire
- MOF: listicles ("best X", "top X"), comparison pages ("[A] vs [B]", "[competitor] alternative"), review roundups — anything where the searcher is evaluating options
- TOF: how-to guides, educational blog posts, informational articles — anything answering "what is" or "how to"
The page TYPE determines intent, not how "browse-y" the query feels. A collection page is BOF even if the buyer is still choosing between products.

Analyze and return JSON with SHORT bullet-point style values (max 2 sentences per field, use dashes for lists):
{
  "intentConfirmation": "BOF|MOF|TOF",
  "intentEvidence": "1-2 sentences on what page types rank and why that confirms the intent",
  "commonalities": "bullet list: - point 1\\n- point 2\\n- point 3 (max 5 bullets, each under 15 words)",
  "gaps": "bullet list: - GAP NAME: one sentence explanation\\n- GAP NAME: one sentence (max 6 gaps)",
  "competitorTargetingScore": "none|partial|direct",
  "competitorTargetingDetail": "1 sentence: who targets it and how, or why nobody does"
}`;

  const response = await claudeMessage(system, prompt, 4096);

  try {
    return JSON.parse(response);
  } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Failed to parse competitive analysis: " + response.slice(0, 200));
  }
}

export interface ServiceValidationOutput {
  serviceMatch: string;
  serviceMatchNote: string;
  recommendedOutline: {
    sections: { title: string; type: string; description: string }[];
    wordCountGuidance: string;
    faqSuggestions: string[];
  };
}

export async function validateServiceAndStructure(params: {
  keyword: string;
  onboardingSummary: string;
  competitiveAnalysis: CompetitiveAnalysisOutput;
}): Promise<ServiceValidationOutput> {
  const system = `You are an SEO strategist. Validate that a keyword matches the client's actual services and recommend a page structure based on SERP analysis. Return valid JSON only, no markdown fences.`;

  const prompt = `Keyword: "${params.keyword}"

Client context:
${params.onboardingSummary}

Competitive analysis for this keyword:
- Intent: ${params.competitiveAnalysis.intentConfirmation}
- Commonalities: ${params.competitiveAnalysis.commonalities}
- Gaps: ${params.competitiveAnalysis.gaps}
- Competitor targeting: ${params.competitiveAnalysis.competitorTargetingDetail}

CRITICAL: Check if the client ACTUALLY offers what this keyword implies. If the keyword suggests a service the client doesn't provide, flag it as a mismatch.

Return JSON with concise values — no paragraphs, descriptions max 10 words each:
{
  "serviceMatch": "confirmed|unconfirmed|mismatch",
  "serviceMatchNote": "1 sentence only — if mismatch say what's wrong, otherwise omit detail",
  "recommendedOutline": {
    "sections": [
      {"title": "section name", "type": "must_have|gap|advantage", "description": "max 10 words: what goes here"}
    ],
    "wordCountGuidance": "e.g. '500-800 words — SERP shows thin PDPs, not long-form'",
    "faqSuggestions": ["5-7 short questions only, no explanations"]
  }
}`;

  const response = await claudeMessage(system, prompt, 4096);

  try {
    return JSON.parse(response);
  } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Failed to parse service validation: " + response.slice(0, 200));
  }
}

export interface SelfValidationOutput {
  confidence: string;
  confidenceNote: string;
  flags: string[];
  recommendation: string;
}

export async function selfValidate(params: {
  keyword: string;
  volume: number;
  kd: number;
  clientDA: number;
  competitiveAnalysis: CompetitiveAnalysisOutput;
  serviceValidation: ServiceValidationOutput;
  semanticVariations: { variation: string; verdict: string }[];
  onboardingSummary: string;
}): Promise<SelfValidationOutput> {
  const system = `You are a senior SEO strategist performing a final quality check on keyword research. Be honest and critical. Return valid JSON only, no markdown fences.

HARD RULES (override all other analysis):
- If volume is 0 and client DA > 5: recommendation MUST be "skip". Zero volume means zero measurable demand. Do not rationalize this as "tool gap" or "hidden demand" — if Mangools, Google Keyword Planner, and keyword-imports all return 0, the keyword has no verified search volume. Period.
- If serviceMatch is "mismatch": recommendation MUST be "skip". Never recommend pursuing a keyword for a service the client does not offer.`;

  const prompt = `Review this keyword analysis and provide a confidence assessment.

Keyword: "${params.keyword}"
Volume: ${params.volume}
KD: ${params.kd}
Client DA: ${params.clientDA}

Competitive analysis:
- Intent: ${params.competitiveAnalysis.intentConfirmation} - ${params.competitiveAnalysis.intentEvidence}
- Targeting: ${params.competitiveAnalysis.competitorTargetingScore} - ${params.competitiveAnalysis.competitorTargetingDetail}
- Commonalities: ${params.competitiveAnalysis.commonalities}
- Gaps: ${params.competitiveAnalysis.gaps}

Service validation: ${params.serviceValidation.serviceMatch} - ${params.serviceValidation.serviceMatchNote}
Page structure: ${params.serviceValidation.recommendedOutline.sections.length} sections proposed
Word count guidance: ${params.serviceValidation.recommendedOutline.wordCountGuidance}

Semantic variations: ${params.semanticVariations.map((v) => `"${v.variation}" = ${v.verdict}`).join(", ") || "none checked"}

Client context:
${params.onboardingSummary}

Return JSON with SHORT concise values — no paragraphs:
{
  "confidence": "high|medium|needs_review",
  "confidenceNote": "1 sentence max explaining the confidence level",
  "flags": ["short flag: 1 sentence each, max 8 flags, only real concerns not generic disclaimers"],
  "recommendation": "pursue|consider|skip — 1 sentence reason only"
}`;

  const response = await claudeMessage(system, prompt, 2048);

  try {
    return JSON.parse(response);
  } catch {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Failed to parse self-validation: " + response.slice(0, 200));
  }
}
