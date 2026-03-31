@AGENTS.md

# Keyword Dashboard v2

Deep keyword research pipeline for The 66th SEO agency. Rebuild from scratch (v1 at ../keyword-dashboard/ is reference only).

## Stack
Next.js 16 + Tailwind 4 + shadcn/ui (base-ui) + Prisma 7 + Supabase Postgres + Anthropic SDK

## Key Architecture
- Single pipeline: Client -> Onboarding -> ResearchSession -> KeywordCandidate -> KeywordAnalysis
- Fire-and-forget for long-running operations (candidate generation, batch analysis) with client-side polling
- Claude Sonnet (claude-sonnet-4-6) for ALL AI calls
- Mangools rate limit: 2.5s delay between calls, 429 retry with 5s backoff
- Semantic variations sourced from Mangools getRelatedKeywords(), NOT Claude
- Next.js 16: params are async (must await). No asChild on shadcn components (base-ui).

## Supabase
Instance: ibdjczlaagiayhfyotoz, us-east-1. Credentials in .env.

## Workflow (source of truth: memory/reference_keyword_research_workflow.md)
1. Create client with DA, upload onboarding doc (.txt)
2. Create research session with scope (e.g. "10 BOF keywords")
3. Generate candidates (Claude, zero Mangools calls)
4. Human selects 3-5 candidates
5. Deep analysis per keyword: Mangools SERP -> fetch top 3 pages -> 3 Claude passes -> semantic variation SERP overlap -> cannibalization check
6. Human reviews: approve / reject / redirect
7. Repeat until scope filled

## Lab Notes
