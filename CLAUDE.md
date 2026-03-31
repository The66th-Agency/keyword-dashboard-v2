@AGENTS.md

# Keyword Dashboard v2

Deep keyword research pipeline for The 66th SEO agency. Rebuild from scratch (v1 at ../keyword-dashboard/ is reference only).

## Stack
Next.js 16 + Tailwind 4 + shadcn/ui (base-ui) + Prisma 7 + Supabase Postgres + Anthropic SDK

## Deployed
Railway: `keyword-dashboard-v2-production.up.railway.app`
GitHub: `The66th-Agency/keyword-dashboard-v2`

## Key Architecture
- Single pipeline: Client -> Onboarding -> ResearchSession -> KeywordCandidate -> KeywordAnalysis
- Fire-and-forget for long-running operations (candidate generation, batch analysis) with client-side polling
- Claude Sonnet (claude-sonnet-4-6) for ALL AI calls
- Mangools rate limit: 2.5s delay between calls, 429 retry with 5s backoff
- Semantic variations sourced from Mangools getRelatedKeywords(), filtered by 2+ word overlap, NOT Claude
- Web search fallback (anthropic-beta: web-search-2025-03-05) when pages blocked or SERP unavailable
- Volume from keyword-imports endpoint (sv field), NOT from SERP endpoint
- Next.js 16: params are async (must await). No asChild on shadcn components (base-ui).
- Prisma 7: requires PrismaPg adapter with pg.Pool. `prisma generate` must be in build script.

## Supabase
Instance: ibdjczlaagiayhfyotoz, us-east-1. Railway uses Session Pooler URL (direct connection is IPv6-only, Railway can't reach it).

## Mangools SERP Response (VERIFIED)
- `data.serp.items` = array of results (NOT data.results)
- `item.m.moz.v.pda` = DA, `item.serpRank` = position (NOT item.pos)
- `data.serp.rank` = KD
- Volume: use keyword-imports endpoint, field is `kw.sv`

## Workflow
1. Create client with DA (auto-fetched via Site Profiler), upload onboarding doc (.txt)
2. Create research session with scope (e.g. "10 BOF keywords")
3. Generate candidates (Claude, 3x scope, short/mid tail, zero Mangools calls)
4. Human selects 3-5 candidates
5. Volume screen (keyword-imports batch call, flags zero-volume for DA > 5)
6. Deep analysis per keyword: Mangools SERP -> fetch top 3 pages (web search fallback if blocked) -> 3 Claude passes -> semantic variation SERP overlap -> cannibalization check
7. Human reviews: approve / reject / redirect
8. Repeat until scope filled

## Pending Fixes (unverified)
- Volume carrying forward from screen step (not re-fetching)
- BOF intent classification (collection/shop pages = BOF not MOF)
- Condensed Claude output (bullets not paragraphs)
- Tail labels: short = 1-2 words, mid = 3 words only

## Lab Notes
- [2026-03-31] Mangools SERP response is data.serp.items NOT data.results. Wasted 3 runs before hitting the API directly to verify. Always verify API response structures against real calls, not memory.
- [2026-03-31] Railway IPv6 issue: direct Supabase connection is IPv6-only. Wasted 1+ hour on code-level fixes when the answer was just "use the Session Pooler URL from Supabase dashboard." Check infrastructure before writing code.
- [2026-03-31] Web search fallback needs multi-turn loop (tool_use -> tool_result -> end_turn). Also needs anthropic-beta header. First attempt returned the preamble text instead of JSON because it only read the first text block.
- [2026-03-31] Content-fetcher returns empty arrays (0/0 fetched, 0 blocked) when SERP items are empty because the parser was wrong. Root cause was always the SERP parser, not the fetcher. Fix the data source, not the symptom.
