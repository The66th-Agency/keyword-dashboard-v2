"use client";

import { useEffect, useState, useCallback, use } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

interface Candidate {
  id: string;
  keyword: string;
  rationale: string;
  funnelStage: string;
  tailLength: string | null;
  volume: number;
  kd: number;
  status: string;
  reviewNote: string | null;
}

interface ScreenResult {
  id: string;
  keyword: string;
  volume: number;
  kd: number;
  zeroVolumeWarning: string | null;
}

interface Analysis {
  id: string;
  candidateId: string;
  keyword: string;
  volume: number;
  kd: number;
  intentConfirmation: string | null;
  intentEvidence: string | null;
  serpCompetitors: string | null;
  targetingAssessment: string | null;
  competitorTargetingScore: string | null;
  competitiveAnalysis: string | null;
  semanticVariations: string | null;
  serviceMatch: string | null;
  serviceMatchNote: string | null;
  recommendedOutline: string | null;
  confidence: string;
  confidenceNote: string | null;
  reviewStatus: string;
  reviewNote: string | null;
  status: string;
  error: string | null;
}

interface Session {
  id: string;
  scope: string;
  status: string;
  error: string | null;
  client: {
    id: string;
    name: string;
    domain: string;
    da: number;
    locationId: number;
    onboardingSummary: string | null;
  };
  candidates: Candidate[];
  analyses: Analysis[];
}

const TAIL_COLORS: Record<string, string> = {
  short: "text-blue-400 border-blue-400/30",
  mid: "text-violet-400 border-violet-400/30",
  long: "text-emerald-400 border-emerald-400/30",
};

export default function SessionPage({ params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const { id: clientId, sessionId } = use(params);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [screening, setScreening] = useState(false);
  const [screenResults, setScreenResults] = useState<ScreenResult[] | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [expandedAnalysis, setExpandedAnalysis] = useState<Set<string>>(new Set());
  const [gscContext, setGscContext] = useState<Record<string, {
    existingRanking: { query: string; page: string; avgPosition: number; impressions: number; clicks: number }[];
    cannibalization: { query: string; severity: string; pages: { url: string; avgPosition: number; impressions: number }[] }[];
  }>>({});

  const fetchSession = useCallback(async () => {
    const res = await fetch(`/api/sessions/${sessionId}`);
    if (res.ok) {
      const data = await res.json();
      setSession(data);
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { fetchSession(); }, [fetchSession]);

  // Fetch GSC ranking context for keywords in review
  useEffect(() => {
    if (!session?.analyses) return;
    const pending = session.analyses.filter((a) => a.status === "complete" && a.reviewStatus === "pending_review");
    for (const analysis of pending) {
      if (gscContext[analysis.keyword]) continue; // Already fetched
      fetch(`/api/clients/${clientId}/gsc-data?type=cannibalization&keyword=${encodeURIComponent(analysis.keyword)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.existingRanking || data.cannibalization) {
            setGscContext((prev) => ({ ...prev, [analysis.keyword]: data }));
          }
        })
        .catch(() => {});
    }
  }, [session?.analyses, clientId]);

  useEffect(() => {
    if (session?.status === "generating_candidates" || session?.status === "analyzing_batch") {
      const interval = setInterval(fetchSession, 3000);
      return () => clearInterval(interval);
    }
  }, [session?.status, fetchSession]);

  const handleGenerate = async () => {
    await fetch(`/api/sessions/${sessionId}/generate`, { method: "POST" });
    fetchSession();
  };

  // Step 1: lock in selection (marks selected/skipped in DB)
  const handleSelect = async () => {
    await fetch(`/api/sessions/${sessionId}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateIds: Array.from(selected) }),
    });
    setSelected(new Set());
    // Immediately run volume screen
    await handleScreen();
    fetchSession();
  };

  // Step 2: run keyword-imports on selected candidates, show volumes + warnings
  const handleScreen = async () => {
    setScreening(true);
    setScreenError(null);
    const res = await fetch(`/api/sessions/${sessionId}/screen`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setScreenResults(data.screened);
    } else {
      const data = await res.json().catch(() => ({}));
      setScreenError(data.error || "Volume screen failed");
    }
    setScreening(false);
  };

  // Step 3: deselect a zero-volume keyword from the screen results
  const handleDeselect = async (candidateId: string) => {
    // Mark back to pending
    await fetch(`/api/sessions/${sessionId}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateIds: [] }), // re-select with empty to just unmark this one
    });
    // Simpler: just remove from screen results locally and mark as skipped via dedicated call
    setScreenResults((prev) => prev?.filter((r) => r.id !== candidateId) || null);
    // Soft-skip this candidate
    await fetch(`/api/sessions/${sessionId}/skip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId }),
    });
    fetchSession();
  };

  const handleAnalyze = async () => {
    setScreenResults(null);
    await fetch(`/api/sessions/${sessionId}/analyze`, { method: "POST" });
    fetchSession();
  };

  const handleReview = async (candidateId: string, analysisId: string, decision: "approved" | "rejected" | "redirected") => {
    await fetch(`/api/sessions/${sessionId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviews: [{ candidateId, analysisId, decision, note: reviewNotes[candidateId] || "" }],
      }),
    });
    fetchSession();
  };

  const handleGenerateMore = async () => {
    setScreenResults(null);
    await fetch(`/api/sessions/${sessionId}/generate`, { method: "POST" });
    fetchSession();
  };

  if (loading || !session) {
    return <div className="text-muted-foreground">Loading session...</div>;
  }

  const candidates = session.candidates;
  const analyses = session.analyses;
  const pendingCandidates = candidates.filter((c) => c.status === "pending");
  const selectedCandidates = candidates.filter((c) => c.status === "selected");
  const approvedCandidates = candidates.filter((c) => c.status === "approved");
  const completedAnalyses = analyses.filter((a) => a.status === "complete");
  const pendingReviewAnalyses = analyses.filter((a) => a.status === "complete" && a.reviewStatus === "pending_review");
  const scopeMatch = session.scope.match(/(\d+)/);
  const scopeTarget = scopeMatch ? parseInt(scopeMatch[1]) : 0;
  const isGenerating = session.status === "generating_candidates";
  const isAnalyzing = session.status === "analyzing_batch";
  const isCompleted = session.status === "completed";

  type Phase = "empty" | "generating" | "select" | "screen" | "analyzing" | "review" | "continue" | "completed";
  let phase: Phase = "empty";
  if (isCompleted) phase = "completed";
  else if (isGenerating) phase = "generating";
  else if (isAnalyzing) phase = "analyzing";
  else if (pendingReviewAnalyses.length > 0) phase = "review";
  else if (screenResults !== null || screening) phase = "screen";
  else if (selectedCandidates.length > 0) phase = "screen"; // selected but not yet screened
  else if (pendingCandidates.length > 0) phase = "select";
  else if (candidates.length > 0 && pendingCandidates.length === 0) phase = "continue";

  // Group pending candidates by tail length for display
  const shortCandidates = pendingCandidates.filter((c) => c.tailLength === "short");
  const midCandidates = pendingCandidates.filter((c) => c.tailLength === "mid");
  const ungrouped = pendingCandidates.filter((c) => !c.tailLength || (c.tailLength !== "short" && c.tailLength !== "mid"));

  const renderCandidateRow = (c: Candidate) => (
    <label
      key={c.id}
      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
        selected.has(c.id) ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
      }`}
    >
      <input
        type="checkbox"
        checked={selected.has(c.id)}
        onChange={() => {
          const next = new Set(selected);
          if (next.has(c.id)) next.delete(c.id);
          else next.add(c.id);
          setSelected(next);
        }}
        className="mt-1 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{c.keyword}</span>
          <Badge variant="outline" className="text-xs">{c.funnelStage}</Badge>
          {c.tailLength && (
            <Badge variant="outline" className={`text-xs ${TAIL_COLORS[c.tailLength] || ""}`}>
              {c.tailLength}-tail
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1">{c.rationale}</p>
      </div>
    </label>
  );

  const renderCandidateGroup = (label: string, group: Candidate[], colorClass: string) => {
    if (group.length === 0) return null;
    return (
      <div key={label}>
        <div className={`text-xs font-medium mb-2 ${colorClass}`}>{label} ({group.length})</div>
        <div className="space-y-2">{group.map(renderCandidateRow)}</div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
        <a href="/clients" className="hover:text-foreground">Clients</a>
        <span>/</span>
        <a href={`/clients/${clientId}`} className="hover:text-foreground">{session.client.name}</a>
        <span>/</span>
        <span className="text-foreground">{session.scope}</span>
      </div>

      <Card className="mb-6">
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">{session.scope}</div>
            <div className="text-sm text-muted-foreground">{approvedCandidates.length} / {scopeTarget} approved</div>
          </div>
          <Progress value={scopeTarget > 0 ? (approvedCandidates.length / scopeTarget) * 100 : 0} />
          {session.error && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{session.error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Phase: Empty */}
      {phase === "empty" && (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground mb-2">No candidates yet.</p>
            <p className="text-xs text-muted-foreground mb-4">
              Claude will generate 3x the scope target across short, mid, and long-tail keywords for you to pick from.
            </p>
            <Button onClick={handleGenerate}>Generate Candidates</Button>
          </CardContent>
        </Card>
      )}

      {/* Phase: Generating */}
      {phase === "generating" && (
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="animate-pulse text-muted-foreground">Generating keyword candidates...</div>
            <p className="text-xs text-muted-foreground mt-2">Claude Sonnet is building a spread of short, mid, and long-tail options.</p>
          </CardContent>
        </Card>
      )}

      {/* Phase: Select */}
      {phase === "select" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Select Candidates ({pendingCandidates.length} total)</span>
              <span className="text-sm font-normal text-muted-foreground">{selected.size} selected</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-5">
              Pick 3-5 to investigate. After confirming, volumes are fetched via Mangools before analysis runs.
            </p>
            <div className="space-y-6">
              {renderCandidateGroup("Short-tail (1-2 words)", shortCandidates, "text-blue-400")}
              {renderCandidateGroup("Mid-tail (3 words)", midCandidates, "text-violet-400")}
              {ungrouped.length > 0 && (
                <div className="space-y-2">{ungrouped.map(renderCandidateRow)}</div>
              )}
            </div>
            {selected.size > 0 && (
              <div className="mt-5 flex items-center gap-3">
                <Button onClick={handleSelect} disabled={screening}>
                  {screening ? "Fetching volumes..." : `Confirm & Screen (${selected.size})`}
                </Button>
                <span className="text-xs text-muted-foreground">Volumes checked via Mangools before analysis</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Phase: Screen - show volume data + warnings */}
      {phase === "screen" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Volume Screen</CardTitle>
          </CardHeader>
          <CardContent>
            {screening && (
              <div className="animate-pulse text-muted-foreground text-sm">Fetching volumes from Mangools...</div>
            )}
            {screenError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{screenError}</AlertDescription>
              </Alert>
            )}
            {screenResults && (
              <>
                {screenResults.filter((r) => r.zeroVolumeWarning).length > 0 && (
                  <Alert className="mb-4 border-amber-400/30 bg-amber-400/10">
                    <AlertDescription className="text-amber-400">
                      {screenResults.filter((r) => r.zeroVolumeWarning).length} keyword{screenResults.filter((r) => r.zeroVolumeWarning).length > 1 ? "s have" : " has"} zero search volume with DA {session.client.da}. Consider removing them before running analysis.
                    </AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2 mb-5">
                  {screenResults.map((r) => (
                    <div key={r.id} className={`flex items-center justify-between p-3 rounded-lg border ${r.zeroVolumeWarning ? "border-amber-400/30 bg-amber-400/5" : "border-border"}`}>
                      <div className="flex items-center gap-3">
                        <div>
                          <span className="text-sm font-medium">{r.keyword}</span>
                          {r.zeroVolumeWarning && (
                            <p className="text-xs text-amber-400 mt-0.5">{r.zeroVolumeWarning}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <span className={`text-sm font-medium ${r.volume === 0 ? "text-amber-400" : ""}`}>
                            {r.volume === 0 ? "0" : r.volume.toLocaleString()} vol
                          </span>
                          <span className="text-xs text-muted-foreground ml-2">KD {r.kd}</span>
                        </div>
                        {r.zeroVolumeWarning && (
                          <Button size="sm" variant="ghost" onClick={() => handleDeselect(r.id)} className="text-xs h-7 text-muted-foreground hover:text-destructive">
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <Button onClick={handleAnalyze}>
                    Run Deep Analysis ({screenResults.length} keyword{screenResults.length !== 1 ? "s" : ""})
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setScreenResults(null); fetchSession(); }}>
                    Back to selection
                  </Button>
                </div>
              </>
            )}
            {/* Selected but not yet screened (page reloaded mid-flow) */}
            {!screenResults && !screening && selectedCandidates.length > 0 && (
              <div>
                <p className="text-sm text-muted-foreground mb-3">{selectedCandidates.length} candidates selected. Run volume screen before analysis.</p>
                <Button onClick={handleScreen}>Screen Volumes</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Phase: Analyzing */}
      {phase === "analyzing" && (() => {
        const ANALYSIS_STEPS = [
          { key: "fetching_serp", label: "Fetching SERP data" },
          { key: "fetching_pages", label: "Fetching competitor pages" },
          { key: "analyzing", label: "Competitive analysis (Claude Pass 1)" },
          { key: "analyzing_pass2", label: "Service validation (Claude Pass 2)" },
          { key: "semantic_variations", label: "Semantic variation check" },
          { key: "self_validating", label: "Self-validation (Claude Pass 3)" },
        ];
        const getStepIndex = (status: string) => {
          const idx = ANALYSIS_STEPS.findIndex((s) => s.key === status);
          return idx >= 0 ? idx : (status === "complete" ? ANALYSIS_STEPS.length : -1);
        };
        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Deep Analysis in Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {analyses.map((a) => {
                  const isExpanded = expandedAnalysis.has(a.id);
                  const activeStep = getStepIndex(a.status);
                  return (
                    <div key={a.id} className="rounded-lg border border-border overflow-hidden">
                      <button
                        onClick={() => setExpandedAnalysis((prev) => {
                          const next = new Set(prev);
                          next.has(a.id) ? next.delete(a.id) : next.add(a.id);
                          return next;
                        })}
                        className="w-full flex items-center justify-between p-3 hover:bg-[#10131C]/50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{isExpanded ? "▾" : "▸"}</span>
                          <span className="text-sm font-medium font-keyword">{a.keyword}</span>
                          {a.status === "complete" && <Badge variant="default" className="text-xs">Complete</Badge>}
                          {a.status === "failed" && <Badge variant="destructive" className="text-xs">Failed</Badge>}
                          {a.status !== "complete" && a.status !== "failed" && (
                            <Badge variant="outline" className="text-xs animate-pulse">{a.status.replace(/_/g, " ")}</Badge>
                          )}
                        </div>
                        {a.status === "complete" && (
                          <span className="text-xs text-muted-foreground font-numbers">Vol: {a.volume} | KD: {a.kd}</span>
                        )}
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-3 pt-1 border-t border-border">
                          <div className="space-y-1.5 ml-2">
                            {ANALYSIS_STEPS.map((step, i) => {
                              const isDone = activeStep > i || a.status === "complete";
                              const isActive = activeStep === i && a.status !== "complete" && a.status !== "failed";
                              return (
                                <div key={step.key} className="flex items-center gap-2.5">
                                  <div className={`w-2 h-2 rounded-full shrink-0 ${isDone ? "bg-[#B1E5E3]" : isActive ? "bg-[#006FFF] animate-pulse" : "border border-border"}`} />
                                  <span className={`text-xs ${isDone ? "text-[#B1E5E3]/70" : isActive ? "text-foreground font-medium" : "text-muted-foreground/50"}`}>
                                    {step.label}
                                  </span>
                                </div>
                              );
                            })}
                            {a.status === "failed" && a.error && (
                              <div className="flex items-center gap-2.5 mt-1">
                                <div className="w-2 h-2 rounded-full shrink-0 bg-destructive" />
                                <span className="text-xs text-destructive">{a.error}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Phase: Review */}
      {phase === "review" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Review Analyses</h2>
            <div className="flex items-center gap-3">
              {approvedCandidates.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => window.open(`/api/sessions/${sessionId}/export`, "_blank")}>
                  Export ({approvedCandidates.length})
                </Button>
              )}
              <span className="text-sm text-muted-foreground">{pendingReviewAnalyses.length} pending review</span>
            </div>
          </div>

          {pendingReviewAnalyses.map((analysis) => {
            const candidate = candidates.find((c) => c.id === analysis.candidateId);
            if (!candidate) return null;

            let compAnalysis: { commonalities?: string; gaps?: string; pagesSource?: string; blockedCount?: number; totalPages?: number } = {};
            try { compAnalysis = JSON.parse(analysis.competitiveAnalysis || "{}"); } catch { /* ignore */ }

            let outline: { sections?: { title: string; type: string; description: string }[]; wordCountGuidance?: string; faqSuggestions?: string[] } = {};
            try { outline = JSON.parse(analysis.recommendedOutline || "{}"); } catch { /* ignore */ }

            let confNote: { note?: string; flags?: string[]; recommendation?: string } = {};
            try { confNote = JSON.parse(analysis.confidenceNote || "{}"); } catch { /* ignore */ }

            let targeting: { url: string; keywordInTitle: boolean; keywordInH1: boolean; keywordInUrl: boolean; keywordInFirstParagraph: boolean }[] = [];
            try { targeting = JSON.parse(analysis.targetingAssessment || "[]"); } catch { /* ignore */ }

            let variations: { variation: string; overlapDomains: string[]; verdict: string }[] = [];
            try { variations = JSON.parse(analysis.semanticVariations || "[]"); } catch { /* ignore */ }

            const isZeroVolume = analysis.volume === 0;
            const clientDA = session.client.da;

            return (
              <Card key={analysis.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-3 flex-wrap">
                    <span className="font-keyword text-lg">{analysis.keyword}</span>
                    <Badge variant="outline" className="text-xs">{analysis.intentConfirmation || candidate.funnelStage}</Badge>
                    {candidate.tailLength && (
                      <Badge variant="outline" className={`text-xs ${TAIL_COLORS[candidate.tailLength] || ""}`}>
                        {candidate.tailLength}-tail
                      </Badge>
                    )}
                    <Badge variant={analysis.confidence === "high" ? "default" : analysis.confidence === "needs_review" ? "destructive" : "secondary"} className="text-xs">
                      {analysis.confidence}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Source warnings */}
                  {compAnalysis.pagesSource === "web_search" && (
                    <p className="text-xs text-amber-400">Pages blocked - analysis via web search. Validate against SERP.</p>
                  )}
                  {compAnalysis.pagesSource === "partial" && (
                    <p className="text-xs text-amber-400">{compAnalysis.blockedCount}/{compAnalysis.totalPages} pages blocked. Partial data.</p>
                  )}
                  {analysis.serviceMatch === "mismatch" && (
                    <p className="text-xs text-destructive font-medium">Service mismatch: {analysis.serviceMatchNote}</p>
                  )}

                  {/* Metrics bar */}
                  <div className="flex gap-4 text-xs flex-wrap items-center">
                    <span className={isZeroVolume ? "text-amber-400 font-medium" : "text-[#B1E5E3]"}>
                      <span className="font-numbers">{analysis.volume.toLocaleString()}</span> vol
                      {isZeroVolume && (clientDA <= 5 ? " (OK low-DA)" : "")}
                    </span>
                    <span className="text-[#B1E5E3]/70">
                      KD <span className="font-numbers">{analysis.kd}</span>
                    </span>
                    <Badge variant={analysis.competitorTargetingScore === "none" ? "default" : "outline"} className="text-xs">
                      {analysis.competitorTargetingScore || "?"} targeting
                    </Badge>
                    <Badge variant={analysis.serviceMatch === "confirmed" ? "default" : analysis.serviceMatch === "mismatch" ? "destructive" : "secondary"} className="text-xs">
                      {analysis.serviceMatch || "?"}
                    </Badge>
                  </div>

                  {/* Intent & Competitive Analysis */}
                  <div className="border-l-2 border-[#B1E5E3]/20 pl-3 space-y-3">
                    {analysis.intentEvidence && (
                      <p className="text-xs text-muted-foreground"><span className="text-foreground font-medium">Intent: </span>{analysis.intentEvidence}</p>
                    )}
                    {compAnalysis.commonalities && (
                      <div className="text-xs">
                        <span className="font-medium text-foreground">In common: </span>
                        <span className="text-muted-foreground">{compAnalysis.commonalities}</span>
                      </div>
                    )}
                    {compAnalysis.gaps && (
                      <div className="text-xs">
                        <span className="font-medium text-foreground">Gaps: </span>
                        <span className="text-muted-foreground">{compAnalysis.gaps}</span>
                      </div>
                    )}
                  </div>

                  {/* Targeting */}
                  {targeting.length > 0 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {targeting.map((t, i) => (
                        <div key={i} className="text-xs flex items-center gap-1">
                          <span className="text-muted-foreground truncate max-w-[180px]">{new URL(t.url).hostname}</span>
                          {t.keywordInTitle && <span className="text-foreground font-medium">T</span>}
                          {t.keywordInH1 && <span className="text-foreground font-medium">H1</span>}
                          {t.keywordInUrl && <span className="text-foreground font-medium">URL</span>}
                          {!t.keywordInTitle && !t.keywordInH1 && !t.keywordInUrl && !t.keywordInFirstParagraph && (
                            <span className="text-[#B1E5E3]">not targeting</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Variations */}
                  {variations.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {variations.map((v, i) => (
                        <span key={i} className="text-xs">
                          &quot;{v.variation}&quot; <Badge variant={v.verdict === "secondary" ? "secondary" : "outline"} className="text-xs">{v.verdict === "secondary" ? "same page" : "sep. page"} ({v.overlapDomains.length})</Badge>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Page structure */}
                  {outline.sections && outline.sections.length > 0 && (
                    <div className="border-l-2 border-[#B1E5E3]/10 pl-3">
                      <div className="text-xs font-medium mb-2">
                        Page structure {outline.wordCountGuidance && <span className="font-normal text-muted-foreground">({outline.wordCountGuidance})</span>}
                      </div>
                      <div className="space-y-1">
                        {outline.sections.map((s, i) => (
                          <div key={i} className="text-xs flex items-start gap-1.5">
                            <Badge variant={s.type === "must_have" ? "secondary" : s.type === "gap" ? "default" : "outline"} className="text-xs shrink-0">{s.type.replace("_", " ")}</Badge>
                            <span className="font-medium">{s.title}</span>
                          </div>
                        ))}
                      </div>
                      {outline.faqSuggestions && outline.faqSuggestions.length > 0 && (
                        <div className="mt-2 text-xs text-muted-foreground">FAQ: {outline.faqSuggestions.slice(0, 3).join(" / ")}{outline.faqSuggestions.length > 3 ? ` +${outline.faqSuggestions.length - 3}` : ""}</div>
                      )}
                    </div>
                  )}

                  {/* Flags & Warnings */}
                  {((confNote.flags && confNote.flags.length > 0) || confNote.recommendation) && (
                    <div className="border-l-2 border-amber-400/20 pl-3 space-y-1">
                      {confNote.flags && confNote.flags.map((f, i) => <div key={i} className="text-xs text-amber-400">{f}</div>)}
                      {confNote.recommendation && (
                        <p className="text-xs font-medium text-foreground">{confNote.recommendation}</p>
                      )}
                    </div>
                  )}

                  {/* GSC Ranking Context */}
                  {gscContext[analysis.keyword] && (gscContext[analysis.keyword].cannibalization.length > 0 || gscContext[analysis.keyword].existingRanking.length > 0) && (
                    <div className="space-y-1.5 rounded-lg bg-[#10131C]/50 px-3 py-2.5">
                      <p className="text-xs font-medium text-[#B1E5E3]">GSC Ranking Context</p>
                      {gscContext[analysis.keyword].cannibalization.length > 0 && (
                        <div className="space-y-0.5">
                          {gscContext[analysis.keyword].cannibalization.map((c, i) => (
                            <div key={i} className="text-xs text-destructive">
                              {c.severity} cannibalization: &quot;{c.query}&quot; — {c.pages.map((p) => `${new URL(p.url).pathname} (pos ${p.avgPosition.toFixed(1)})`).join(" vs ")}
                            </div>
                          ))}
                        </div>
                      )}
                      {gscContext[analysis.keyword].existingRanking.length > 0 && (
                        <div className="space-y-0.5">
                          {gscContext[analysis.keyword].existingRanking.slice(0, 5).map((r, i) => (
                            <div key={i} className="text-xs text-muted-foreground">
                              Ranking: &quot;{r.query}&quot; — pos <span className="font-numbers">{r.avgPosition.toFixed(1)}</span>, <span className="font-numbers">{r.impressions}</span> imp ({new URL(r.page).pathname})
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Review action bar */}
                  <div className="bg-[#10131C]/30 -mx-4 px-4 pt-4 pb-3 mt-2 rounded-b-2xl flex items-start gap-2">
                    <textarea
                      placeholder="Notes..."
                      value={reviewNotes[candidate.id] || ""}
                      onChange={(e) => setReviewNotes({ ...reviewNotes, [candidate.id]: e.target.value })}
                      rows={1}
                      className="flex-1 rounded-[8px] border border-input bg-transparent px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                    />
                    <Button size="sm" onClick={() => handleReview(candidate.id, analysis.id, "approved")}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => handleReview(candidate.id, analysis.id, "rejected")}>Reject</Button>
                    <Button size="sm" variant="secondary" onClick={() => handleReview(candidate.id, analysis.id, "redirected")}>Redirect</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Phase: Continue */}
      {phase === "continue" && (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground mb-2">
              {approvedCandidates.length} / {scopeTarget} approved. Need {scopeTarget - approvedCandidates.length} more.
            </p>
            <Button onClick={handleGenerateMore}>Generate More Candidates</Button>
          </CardContent>
        </Card>
      )}

      {/* Phase: Completed */}
      {phase === "completed" && (
        <Card>
          <CardContent className="pt-6 text-center space-y-3">
            <div className="text-lg font-semibold">Session Complete</div>
            <p className="text-muted-foreground">{approvedCandidates.length} keywords approved.</p>
            <Button variant="outline" onClick={() => window.open(`/api/sessions/${sessionId}/export`, "_blank")}>
              Export Approved Keywords (TSV)
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Reviewed keywords log */}
      {(approvedCandidates.length > 0 || candidates.filter((c) => c.status === "rejected" || c.status === "redirected").length > 0) && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Reviewed Keywords</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {candidates
                .filter((c) => ["approved", "rejected", "redirected"].includes(c.status))
                .map((c) => {
                  const analysis = analyses.find((a) => a.candidateId === c.id);
                  return (
                    <div key={c.id} className="flex items-center justify-between p-2 rounded border border-border">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{c.keyword}</span>
                        <Badge variant="outline" className="text-xs">{c.funnelStage}</Badge>
                        {c.tailLength && (
                          <Badge variant="outline" className={`text-xs ${TAIL_COLORS[c.tailLength] || ""}`}>{c.tailLength}</Badge>
                        )}
                        {analysis && <span className="text-xs text-muted-foreground">Vol: {analysis.volume} | KD: {analysis.kd}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={c.status === "approved" ? "default" : c.status === "rejected" ? "destructive" : "secondary"} className="text-xs">
                          {c.status}
                        </Badge>
                        {c.reviewNote && <span className="text-xs text-muted-foreground max-w-[200px] truncate">{c.reviewNote}</span>}
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* In-progress analyses shown during non-review phases */}
      {phase !== "review" && completedAnalyses.filter((a) => a.reviewStatus === "pending_review").length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Awaiting Review</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {completedAnalyses
                .filter((a) => a.reviewStatus === "pending_review")
                .map((a) => (
                  <div key={a.id} className="text-sm flex items-center gap-2">
                    <span>{a.keyword}</span>
                    <span className="text-xs text-muted-foreground">Vol: {a.volume} | KD: {a.kd}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
