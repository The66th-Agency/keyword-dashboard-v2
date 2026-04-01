"use client";

import { useEffect, useState, useCallback, use } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

// Compute opportunity score from existing fields (0-5 dots)
function computeOpportunityScore(analysis: Analysis, clientDA: number): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (analysis.serviceMatch === "confirmed") { score += 1; reasons.push("Service confirmed"); }
  if (analysis.competitorTargetingScore === "none") { score += 2; reasons.push("No competitors targeting"); }
  else if (analysis.competitorTargetingScore === "partial") { score += 1; reasons.push("Partial competitor targeting"); }
  if (analysis.confidence === "high") { score += 1; reasons.push("High confidence"); }
  if (analysis.kd < clientDA + 20) { score += 1; reasons.push(`KD ${analysis.kd} < DA+20 (${clientDA + 20})`); }
  return { score, reasons };
}

// KD colour based on difficulty range
function kdColor(kd: number): string {
  if (kd <= 29) return "text-[#B1E5E3]";
  if (kd <= 59) return "text-muted-foreground";
  if (kd <= 79) return "text-amber-400";
  return "text-destructive";
}

// Recommendation colour + label
function recStyle(rec: string | undefined): { bg: string; text: string; label: string } {
  if (!rec) return { bg: "bg-muted", text: "text-muted-foreground", label: "PENDING" };
  const lower = rec.toLowerCase();
  if (lower.startsWith("pursue")) return { bg: "bg-[#B1E5E3]/15", text: "text-[#B1E5E3]", label: "PURSUE" };
  if (lower.startsWith("consider")) return { bg: "bg-amber-400/15", text: "text-amber-400", label: "CONSIDER" };
  return { bg: "bg-destructive/15", text: "text-destructive", label: "SKIP" };
}

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
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [gscContext, setGscContext] = useState<Record<string, {
    existingRanking: { query: string; page: string; avgPosition: number; impressions: number; clicks: number; urlType: string; action: string; suggestion: string; isQuickWin: boolean }[];
    cannibalization: { query: string; severity: string; suggestion: string; pages: { url: string; avgPosition: number; impressions: number; clicks: number; urlType: string; impressionShare: number }[] }[];
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
      if (gscContext[analysis.keyword]) continue;
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

  // Auto-select first review keyword
  useEffect(() => {
    if (!session?.analyses) return;
    const pending = session.analyses.filter((a) => a.status === "complete" && a.reviewStatus === "pending_review");
    if (pending.length > 0 && !selectedReviewId) {
      setSelectedReviewId(pending[0].id);
    }
  }, [session?.analyses, selectedReviewId]);

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

  const handleSelect = async () => {
    await fetch(`/api/sessions/${sessionId}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateIds: Array.from(selected) }),
    });
    setSelected(new Set());
    await handleScreen();
    fetchSession();
  };

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

  const handleDeselect = async (candidateId: string) => {
    setScreenResults((prev) => prev?.filter((r) => r.id !== candidateId) || null);
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
    // Auto-advance to next keyword
    const pending = session?.analyses.filter((a) => a.status === "complete" && a.reviewStatus === "pending_review" && a.id !== analysisId) || [];
    if (pending.length > 0) setSelectedReviewId(pending[0].id);
    else setSelectedReviewId(null);
    fetchSession();
  };

  const handleGenerateMore = async () => {
    setScreenResults(null);
    await fetch(`/api/sessions/${sessionId}/generate`, { method: "POST" });
    fetchSession();
  };

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
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
  else if (selectedCandidates.length > 0) phase = "screen";
  else if (pendingCandidates.length > 0) phase = "select";
  else if (candidates.length > 0 && pendingCandidates.length === 0) phase = "continue";

  const shortCandidates = pendingCandidates.filter((c) => c.tailLength === "short");
  const midCandidates = pendingCandidates.filter((c) => c.tailLength === "mid");
  const ungrouped = pendingCandidates.filter((c) => !c.tailLength || (c.tailLength !== "short" && c.tailLength !== "mid"));

  const renderCandidateRow = (c: Candidate) => (
    <label
      key={c.id}
      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
        selected.has(c.id) ? "border-[#006FFF] bg-[#006FFF]/5" : "border-border hover:bg-[#10131C]/50"
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
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.rationale}</p>
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

  // Opportunity dots component
  const OpportunityDots = ({ analysis }: { analysis: Analysis }) => {
    const { score, reasons } = computeOpportunityScore(analysis, session.client.da);
    return (
      <div className="flex items-center gap-0.5" title={reasons.join("\n")}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`w-1.5 h-1.5 rounded-full ${i < score ? "bg-[#B1E5E3]" : "bg-[#10131C] border border-border"}`} />
        ))}
      </div>
    );
  };

  // Get selected analysis for split-pane detail view
  const selectedAnalysis = pendingReviewAnalyses.find((a) => a.id === selectedReviewId) || null;
  const selectedCandidate = selectedAnalysis ? candidates.find((c) => c.id === selectedAnalysis.candidateId) : null;

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
            <div className="flex items-center gap-3">
              {approvedCandidates.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => window.open(`/api/sessions/${sessionId}/export`, "_blank")}>
                  Export ({approvedCandidates.length})
                </Button>
              )}
              <div className="text-sm text-muted-foreground font-numbers">{approvedCandidates.length} / {scopeTarget} approved</div>
            </div>
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
              Claude will generate 3x the scope target across short and mid-tail keywords for you to pick from.
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
            <p className="text-xs text-muted-foreground mt-2">Claude Sonnet is building a spread of short and mid-tail options.</p>
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
              <div className="mt-5 sticky bottom-0 bg-background/90 backdrop-blur-sm py-3 -mx-4 px-4 border-t border-border">
                <div className="flex items-center gap-3">
                  <Button onClick={handleSelect} disabled={screening}>
                    {screening ? "Fetching volumes..." : `Confirm & Screen (${selected.size})`}
                  </Button>
                  <span className="text-xs text-muted-foreground">Volumes checked via Mangools before analysis</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Phase: Screen */}
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
                  <div className="mb-4 flex items-center justify-between p-3 rounded-lg border border-amber-400/30 bg-amber-400/5">
                    <span className="text-xs text-amber-400">
                      {screenResults.filter((r) => r.zeroVolumeWarning).length} keyword{screenResults.filter((r) => r.zeroVolumeWarning).length > 1 ? "s have" : " has"} zero search volume with DA {session.client.da}.
                    </span>
                    <Button size="sm" variant="ghost" className="text-xs text-amber-400 hover:text-amber-300" onClick={() => {
                      const zeroIds = screenResults.filter((r) => r.zeroVolumeWarning).map((r) => r.id);
                      zeroIds.forEach((id) => handleDeselect(id));
                    }}>
                      Remove all zero-volume
                    </Button>
                  </div>
                )}
                <div className="space-y-2 mb-5">
                  {screenResults.map((r) => (
                    <div key={r.id} className={`flex items-center justify-between p-3 rounded-lg border ${r.zeroVolumeWarning ? "border-amber-400/30 bg-amber-400/5" : "border-border"}`}>
                      <span className="text-sm font-medium">{r.keyword}</span>
                      <div className="flex items-center gap-4">
                        <span className={`text-sm font-numbers ${r.volume === 0 ? "text-amber-400" : "text-[#B1E5E3]"}`}>
                          {r.volume === 0 ? "0" : r.volume.toLocaleString()} vol
                        </span>
                        <span className={`text-xs font-numbers ${kdColor(r.kd)}`}>KD {r.kd}</span>
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

      {/* Phase: Review - SPLIT PANE */}
      {phase === "review" && (() => {
        // Parse analysis data for the selected keyword
        const a = selectedAnalysis;
        const c = selectedCandidate;

        let compAnalysis: { commonalities?: string; gaps?: string; pagesSource?: string; blockedCount?: number; totalPages?: number } = {};
        let outline: { sections?: { title: string; type: string; description: string }[]; wordCountGuidance?: string; faqSuggestions?: string[] } = {};
        let confNote: { note?: string; flags?: string[]; recommendation?: string } = {};
        let targeting: { url: string; keywordInTitle: boolean; keywordInH1: boolean; keywordInUrl: boolean; keywordInFirstParagraph: boolean }[] = [];
        let variations: { variation: string; overlapDomains: string[]; verdict: string }[] = [];

        if (a) {
          try { compAnalysis = JSON.parse(a.competitiveAnalysis || "{}"); } catch { /* */ }
          try { outline = JSON.parse(a.recommendedOutline || "{}"); } catch { /* */ }
          try { confNote = JSON.parse(a.confidenceNote || "{}"); } catch { /* */ }
          try { targeting = JSON.parse(a.targetingAssessment || "[]"); } catch { /* */ }
          try { variations = JSON.parse(a.semanticVariations || "[]"); } catch { /* */ }
        }

        const rec = recStyle(confNote.recommendation);

        return (
          <div className="flex gap-4" style={{ minHeight: "calc(100vh - 220px)" }}>
            {/* LEFT RAIL - Keyword List */}
            <div className="w-[300px] shrink-0 space-y-1 overflow-y-auto" style={{ maxHeight: "calc(100vh - 220px)" }}>
              <div className="text-xs text-muted-foreground mb-2 px-2">{pendingReviewAnalyses.length} pending review</div>
              {pendingReviewAnalyses.map((analysis) => {
                const cand = candidates.find((ca) => ca.id === analysis.candidateId);
                const opp = computeOpportunityScore(analysis, session.client.da);
                const isSelected = analysis.id === selectedReviewId;
                let note: { recommendation?: string } = {};
                try { note = JSON.parse(analysis.confidenceNote || "{}"); } catch { /* */ }
                const r = recStyle(note.recommendation);

                return (
                  <button
                    key={analysis.id}
                    onClick={() => { setSelectedReviewId(analysis.id); setExpandedSections(new Set()); }}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      isSelected ? "border-[#006FFF] bg-[#006FFF]/5" : "border-border hover:bg-[#10131C]/50"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium font-keyword truncate pr-2">{analysis.keyword}</span>
                      <OpportunityDots analysis={analysis} />
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-numbers text-[#B1E5E3]">{analysis.volume.toLocaleString()}</span>
                      <span className={`font-numbers ${kdColor(analysis.kd)}`}>KD {analysis.kd}</span>
                      <Badge variant="outline" className="text-xs h-4 px-1">{analysis.intentConfirmation || cand?.funnelStage}</Badge>
                      {gscContext[analysis.keyword]?.existingRanking.some((er) => er.isQuickWin) && (
                        <Badge variant="default" className="text-xs h-4 px-1 bg-[#006FFF]/20 text-[#006FFF]">QW</Badge>
                      )}
                      {gscContext[analysis.keyword]?.cannibalization.length > 0 && (
                        <Badge variant="destructive" className="text-xs h-4 px-1">C</Badge>
                      )}
                      <span className={`ml-auto text-xs font-medium ${r.text}`}>{r.label}</span>
                    </div>
                  </button>
                );
              })}

              {/* Reviewed keywords in the rail */}
              {candidates.filter((ca) => ["approved", "rejected", "redirected"].includes(ca.status)).length > 0 && (
                <>
                  <Separator className="my-2" />
                  <div className="text-xs text-muted-foreground mb-1 px-2">Reviewed</div>
                  {candidates.filter((ca) => ["approved", "rejected", "redirected"].includes(ca.status)).map((ca) => (
                    <div key={ca.id} className="px-3 py-2 rounded-lg text-xs flex items-center justify-between opacity-60">
                      <span className="truncate">{ca.keyword}</span>
                      <Badge variant={ca.status === "approved" ? "default" : ca.status === "rejected" ? "destructive" : "secondary"} className="text-xs h-4 px-1 shrink-0">
                        {ca.status}
                      </Badge>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* RIGHT PANE - Detail View */}
            <div className="flex-1 min-w-0 overflow-y-auto" style={{ maxHeight: "calc(100vh - 220px)" }}>
              {a && c ? (
                <Card>
                  <CardContent className="pt-5 space-y-5">
                    {/* DECISION BAR - Recommendation first */}
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="font-keyword text-xl mb-2">{a.keyword}</h2>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-[#B1E5E3] font-numbers text-sm">{a.volume.toLocaleString()} vol</span>
                          <span className={`font-numbers text-sm ${kdColor(a.kd)}`}>KD {a.kd}</span>
                          <Badge variant="outline" className="text-xs">{a.intentConfirmation || c.funnelStage}</Badge>
                          {c.tailLength && (
                            <Badge variant="outline" className={`text-xs ${TAIL_COLORS[c.tailLength] || ""}`}>{c.tailLength}-tail</Badge>
                          )}
                          <OpportunityDots analysis={a} />
                        </div>
                      </div>
                      <div className={`${rec.bg} ${rec.text} px-4 py-2 rounded-lg text-sm font-semibold shrink-0`}>
                        {rec.label}
                      </div>
                    </div>

                    {/* Source warnings */}
                    {compAnalysis.pagesSource === "web_search" && (
                      <p className="text-xs text-amber-400">Pages blocked - analysis via web search. Validate against SERP.</p>
                    )}
                    {a.serviceMatch === "mismatch" && (
                      <p className="text-xs text-destructive font-medium">Service mismatch: {a.serviceMatchNote}</p>
                    )}

                    {/* RATIONALE - The "confirm or override" surface */}
                    {confNote.recommendation && (
                      <div className="rounded-lg bg-[#10131C]/50 px-4 py-3">
                        <p className="text-sm text-foreground">{confNote.recommendation}</p>
                        {confNote.flags && confNote.flags.length > 0 && (
                          <div className="mt-2 space-y-0.5">
                            {confNote.flags.slice(0, 3).map((f, i) => <p key={i} className="text-xs text-amber-400">{f}</p>)}
                            {confNote.flags.length > 3 && <p className="text-xs text-muted-foreground">+{confNote.flags.length - 3} more warnings</p>}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Badges row */}
                    <div className="flex gap-2 flex-wrap">
                      <Badge variant={a.competitorTargetingScore === "none" ? "default" : "outline"} className="text-xs">
                        {a.competitorTargetingScore || "?"} targeting
                      </Badge>
                      <Badge variant={a.serviceMatch === "confirmed" ? "default" : a.serviceMatch === "mismatch" ? "destructive" : "secondary"} className="text-xs">
                        {a.serviceMatch || "?"}
                      </Badge>
                      <Badge variant={a.confidence === "high" ? "default" : a.confidence === "needs_review" ? "destructive" : "secondary"} className="text-xs">
                        {a.confidence}
                      </Badge>
                    </div>

                    <Separator />

                    {/* COLLAPSIBLE SECTIONS */}

                    {/* Intent & Competitive Analysis */}
                    <button onClick={() => toggleSection("competitive")} className="w-full text-left flex items-center justify-between text-xs font-medium text-foreground hover:text-[#B1E5E3] transition-colors">
                      <span>Competitive Analysis</span>
                      <span className="text-muted-foreground">{expandedSections.has("competitive") ? "▾" : "▸"}</span>
                    </button>
                    {expandedSections.has("competitive") && (
                      <div className="border-l-2 border-[#B1E5E3]/20 pl-3 space-y-3">
                        {a.intentEvidence && (
                          <p className="text-xs text-muted-foreground"><span className="text-foreground font-medium">Intent: </span>{a.intentEvidence}</p>
                        )}
                        {compAnalysis.commonalities && (
                          <div className="text-xs"><span className="font-medium text-foreground">In common: </span><span className="text-muted-foreground">{compAnalysis.commonalities}</span></div>
                        )}
                        {compAnalysis.gaps && (
                          <div className="text-xs"><span className="font-medium text-foreground">Gaps: </span><span className="text-muted-foreground">{compAnalysis.gaps}</span></div>
                        )}
                      </div>
                    )}

                    {/* Targeting Grid */}
                    {targeting.length > 0 && (
                      <>
                        <button onClick={() => toggleSection("targeting")} className="w-full text-left flex items-center justify-between text-xs font-medium text-foreground hover:text-[#B1E5E3] transition-colors">
                          <span>Targeting Assessment ({targeting.length} competitors)</span>
                          <span className="text-muted-foreground">{expandedSections.has("targeting") ? "▾" : "▸"}</span>
                        </button>
                        {expandedSections.has("targeting") && (
                          <div className="border-l-2 border-[#B1E5E3]/10 pl-3">
                            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 gap-y-1 text-xs">
                              <span className="text-muted-foreground font-medium">Domain</span>
                              <span className="text-muted-foreground font-medium text-center">Title</span>
                              <span className="text-muted-foreground font-medium text-center">H1</span>
                              <span className="text-muted-foreground font-medium text-center">URL</span>
                              {targeting.map((t, i) => (
                                <div key={i} className="contents">
                                  <span className="text-muted-foreground truncate">{new URL(t.url).hostname}</span>
                                  <span className="text-center">{t.keywordInTitle ? <span className="text-[#B1E5E3]">✓</span> : <span className="text-muted-foreground/30">-</span>}</span>
                                  <span className="text-center">{t.keywordInH1 ? <span className="text-[#B1E5E3]">✓</span> : <span className="text-muted-foreground/30">-</span>}</span>
                                  <span className="text-center">{t.keywordInUrl ? <span className="text-[#B1E5E3]">✓</span> : <span className="text-muted-foreground/30">-</span>}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Semantic Variations */}
                    {variations.length > 0 && (
                      <>
                        <button onClick={() => toggleSection("variations")} className="w-full text-left flex items-center justify-between text-xs font-medium text-foreground hover:text-[#B1E5E3] transition-colors">
                          <span>Semantic Variations ({variations.length})</span>
                          <span className="text-muted-foreground">{expandedSections.has("variations") ? "▾" : "▸"}</span>
                        </button>
                        {expandedSections.has("variations") && (
                          <div className="flex flex-wrap gap-2 pl-3">
                            {variations.map((v, i) => (
                              <span key={i} className="text-xs">
                                &quot;{v.variation}&quot; <Badge variant={v.verdict === "secondary" ? "secondary" : "outline"} className="text-xs">{v.verdict === "secondary" ? "same page" : "sep. page"} ({v.overlapDomains.length})</Badge>
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {/* Page Structure - collapsed, auto-expands after approval */}
                    {outline.sections && outline.sections.length > 0 && (
                      <>
                        <button onClick={() => toggleSection("outline")} className="w-full text-left flex items-center justify-between text-xs font-medium text-foreground hover:text-[#B1E5E3] transition-colors">
                          <span>Page Structure ({outline.sections.length} sections{outline.wordCountGuidance ? ` - ${outline.wordCountGuidance}` : ""})</span>
                          <span className="text-muted-foreground">{expandedSections.has("outline") ? "▾" : "▸"}</span>
                        </button>
                        {expandedSections.has("outline") && (
                          <div className="border-l-2 border-[#B1E5E3]/10 pl-3 space-y-1">
                            {outline.sections.map((s, i) => (
                              <div key={i} className="text-xs flex items-start gap-1.5">
                                <Badge variant={s.type === "must_have" ? "secondary" : s.type === "gap" ? "default" : "outline"} className="text-xs shrink-0">{s.type.replace("_", " ")}</Badge>
                                <span className="font-medium">{s.title}</span>
                              </div>
                            ))}
                            {outline.faqSuggestions && outline.faqSuggestions.length > 0 && (
                              <div className="mt-2 text-xs text-muted-foreground">FAQ: {outline.faqSuggestions.slice(0, 3).join(" / ")}{outline.faqSuggestions.length > 3 ? ` +${outline.faqSuggestions.length - 3}` : ""}</div>
                            )}
                          </div>
                        )}
                      </>
                    )}

                    {/* All flags (expanded) */}
                    {confNote.flags && confNote.flags.length > 3 && (
                      <>
                        <button onClick={() => toggleSection("flags")} className="w-full text-left flex items-center justify-between text-xs font-medium text-foreground hover:text-[#B1E5E3] transition-colors">
                          <span>All Warnings ({confNote.flags.length})</span>
                          <span className="text-muted-foreground">{expandedSections.has("flags") ? "▾" : "▸"}</span>
                        </button>
                        {expandedSections.has("flags") && (
                          <div className="border-l-2 border-amber-400/20 pl-3 space-y-0.5">
                            {confNote.flags.map((f, i) => <div key={i} className="text-xs text-amber-400">{f}</div>)}
                          </div>
                        )}
                      </>
                    )}

                    {/* GSC Ranking Context */}
                    {gscContext[a.keyword] && (gscContext[a.keyword].cannibalization.length > 0 || gscContext[a.keyword].existingRanking.length > 0) && (
                      <>
                        <button onClick={() => toggleSection("gsc")} className="w-full text-left flex items-center justify-between text-xs font-medium text-[#B1E5E3] hover:text-[#B1E5E3]/80 transition-colors">
                          <span>GSC Ranking Context {gscContext[a.keyword].cannibalization.length > 0 && <Badge variant="destructive" className="text-xs ml-2">{gscContext[a.keyword].cannibalization.length} cannibalization</Badge>}</span>
                          <span className="text-muted-foreground">{expandedSections.has("gsc") ? "▾" : "▸"}</span>
                        </button>
                        {expandedSections.has("gsc") && (
                          <div className="space-y-4 rounded-lg bg-[#10131C]/50 px-3 py-3">
                            {/* Cannibalization issues */}
                            {gscContext[a.keyword].cannibalization.map((ca, i) => (
                              <div key={`cann-${i}`} className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <Badge variant="destructive" className="text-xs">{ca.severity}</Badge>
                                  <span className="text-xs font-medium text-foreground">&quot;{ca.query}&quot;</span>
                                </div>
                                <div className="space-y-1 ml-2">
                                  {ca.pages.map((p, j) => (
                                    <div key={j} className="text-xs flex items-center gap-2">
                                      <span className="font-numbers text-foreground">#{p.avgPosition.toFixed(0)}</span>
                                      <span className="text-muted-foreground truncate">{new URL(p.url).pathname}</span>
                                      <Badge variant="outline" className="text-xs h-4 px-1">{p.urlType}</Badge>
                                      <span className="text-muted-foreground font-numbers ml-auto">{p.impressionShare}%</span>
                                    </div>
                                  ))}
                                </div>
                                <p className="text-xs text-amber-400 ml-2">{ca.suggestion}</p>
                              </div>
                            ))}

                            {/* Existing rankings with actions */}
                            {gscContext[a.keyword].existingRanking.length > 0 && (
                              <div className="space-y-2">
                                {gscContext[a.keyword].cannibalization.length > 0 && <Separator />}
                                {gscContext[a.keyword].existingRanking.slice(0, 8).map((r, i) => (
                                  <div key={`rank-${i}`} className="space-y-1">
                                    <div className="text-xs flex items-center gap-2">
                                      <span className="font-numbers text-foreground w-6">#{r.avgPosition.toFixed(0)}</span>
                                      <span className="text-muted-foreground">&quot;{r.query}&quot;</span>
                                      <span className="font-numbers text-muted-foreground ml-auto">{r.impressions} imp</span>
                                    </div>
                                    <div className="text-xs flex items-center gap-2 ml-8">
                                      <span className="text-muted-foreground/70 truncate">{new URL(r.page).pathname}</span>
                                      <Badge variant="outline" className="text-xs h-4 px-1">{r.urlType}</Badge>
                                      <Badge variant={r.action === "Create New Page" ? "default" : r.action === "Strengthen" ? "secondary" : "outline"} className="text-xs h-4 px-1">{r.action}</Badge>
                                      {r.isQuickWin && <Badge variant="default" className="text-xs h-4 px-1 bg-[#006FFF]/20 text-[#006FFF]">Quick Win</Badge>}
                                    </div>
                                    <p className="text-xs text-muted-foreground/70 ml-8">{r.suggestion}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}

                    {/* ACTION BAR - sticky bottom */}
                    <div className="bg-[#10131C]/30 -mx-4 px-4 pt-4 pb-3 mt-2 rounded-b-2xl sticky bottom-0">
                      <div className="flex items-start gap-2">
                        <textarea
                          placeholder="Notes..."
                          value={reviewNotes[c.id] || ""}
                          onChange={(e) => setReviewNotes({ ...reviewNotes, [c.id]: e.target.value })}
                          rows={1}
                          className="flex-1 rounded-[8px] border border-input bg-transparent px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                        />
                        <Button size="sm" onClick={() => handleReview(c.id, a.id, "approved")}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => handleReview(c.id, a.id, "rejected")}>Reject</Button>
                        <Button size="sm" variant="secondary" onClick={() => handleReview(c.id, a.id, "redirected")}>Redirect</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="pt-6 text-center text-muted-foreground">
                    Select a keyword from the list to review.
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        );
      })()}

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

      {/* Reviewed keywords log (non-review phases) */}
      {phase !== "review" && (approvedCandidates.length > 0 || candidates.filter((c) => c.status === "rejected" || c.status === "redirected").length > 0) && (
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
                        {analysis && <span className="text-xs text-muted-foreground font-numbers">Vol: {analysis.volume} | KD: {analysis.kd}</span>}
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
                    <span className="text-xs text-muted-foreground font-numbers">Vol: {a.volume} | KD: {a.kd}</span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
