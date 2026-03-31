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
  tailLength: string; // short | mid | long
}

export async function generateCandidates(params: {
  onboardingSummary: string;
  clientDA: number;
  existingPages: string[];
  scope: string;
}): Promise<CandidateOutput[]> {
  const system = `You are an expert SEO keyword researcher for The 66th, an SEO agency. You suggest keyword candidates based on deep understanding of the client's business, their domain authority, and search intent.

Rules:
- ONLY suggest keywords for services the client actually offers (check the onboarding summary)
- Consider the client's DA when suggesting keywords. DA ${params.clientDA} means:
  ${params.clientDA <= 5 ? "Focus on zero/very low volume long-tail keywords. Topical authority play from scratch." : ""}
  ${params.clientDA > 5 && params.clientDA <= 15 ? "Target 10-200 volume keywords. Long-tail focus. Avoid competitive head terms." : ""}
  ${params.clientDA > 15 && params.clientDA <= 30 ? "Mix of long-tail and mid-tail. Some moderate competition viable." : ""}
  ${params.clientDA > 30 && params.clientDA <= 50 ? "Competitive keywords viable. Can target mid-range terms with confidence." : ""}
  ${params.clientDA > 50 ? "No cap on competitiveness. Can pursue high-volume head terms." : ""}
- For local businesses: include city/region IN the keyword itself (e.g. "roof cleaning Vancouver")
- For national/SaaS: broader keywords without geo modifiers
- Label each with funnel stage: BOF (service/product pages), MOF (comparison/listicle), TOF (educational/guide)
- Label each with tail length: short (1-2 words e.g. "maple syrup", "maple coffee"), mid (3 words e.g. "maple syrup Canada", "organic maple coffee")
- Split evenly: half short-tail, half mid-tail. No long-tail.
- Do NOT suggest keywords that already have pages (see existing pages list)
- Provide a specific rationale for each keyword - what makes it a real opportunity, not generic filler

Return valid JSON array only, no markdown fences:
[{"keyword": "", "rationale": "", "funnelStage": "BOF|MOF|TOF", "tailLength": "short|mid"}]`;

  // Parse numeric target from scope (e.g. "10 BOF keywords" -> 10), generate 3x for human filtering
  const scopeMatch = params.scope.match(/(\d+)/);
  const scopeTarget = scopeMatch ? parseInt(scopeMatch[1]) : 10;
  const generateTarget = scopeTarget * 3;

  const prompt = `Client onboarding summary:
${params.onboardingSummary}

Client DA: ${params.clientDA}

Existing client pages (do NOT suggest keywords these already target):
${params.existingPages.length > 0 ? params.existingPages.join("\n") : "No existing pages found"}

Scope: ${params.scope}

Generate ${generateTarget} keyword candidates (3x the scope target - the human reviews all of these and selects the best ones before any research runs, so give them plenty of range). Spread across short-tail, mid-tail, and long-tail. Be specific and non-obvious. Think like the client's ideal customer at different stages of awareness.`;

  const response = await claudeMessage(system, prompt, 4096);

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

Return JSON:
{
  "intentConfirmation": "BOF|MOF|TOF",
  "intentEvidence": "what the actual pages are (product pages, service pages, etc.) and why this confirms the intent",
  "commonalities": "what all ranking pages share in terms of content, structure, depth",
  "gaps": "what is specifically missing from ranking pages - be concrete",
  "competitorTargetingScore": "none|partial|direct",
  "competitorTargetingDetail": "which pages target the exact keyword and which don't"
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
  const system = `You are a senior SEO strategist performing a final quality check on keyword research. Be honest and critical. Return valid JSON only, no markdown fences.`;

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
