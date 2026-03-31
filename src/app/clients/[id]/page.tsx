"use client";

import { useEffect, useState, use } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface ExistingPage {
  id: string;
  url: string;
  title: string | null;
  inferredKeyword: string | null;
}

interface Session {
  id: string;
  scope: string;
  status: string;
  createdAt: string;
  _count: { candidates: number; analyses: number };
  candidates: { id: string }[]; // approved only
}

interface ClientDetail {
  id: string;
  name: string;
  domain: string;
  da: number;
  sitemapUrl: string | null;
  locationId: number;
  languageId: number;
  onboardingDoc: string | null;
  onboardingSummary: string | null;
  pages: ExistingPage[];
  sessions: Session[];
}

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", domain: "", da: "0", sitemapUrl: "", locationId: "2124" });
  const [onboardingText, setOnboardingText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [pasteUrls, setPasteUrls] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [newScope, setNewScope] = useState("10 BOF keywords");

  const fetchClient = async () => {
    const res = await fetch(`/api/clients/${id}`);
    if (res.ok) {
      const data = await res.json();
      setClient(data);
      setEditForm({
        name: data.name,
        domain: data.domain,
        da: String(data.da),
        sitemapUrl: data.sitemapUrl || "",
        locationId: String(data.locationId),
      });
    }
    setLoading(false);
  };

  useEffect(() => { fetchClient(); }, [id]);

  // Poll for onboarding summary if doc exists but summary doesn't
  useEffect(() => {
    if (client?.onboardingDoc && !client?.onboardingSummary) {
      const interval = setInterval(fetchClient, 3000);
      return () => clearInterval(interval);
    }
  }, [client?.onboardingDoc, client?.onboardingSummary]);

  const handleEdit = async () => {
    await fetch(`/api/clients/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editForm.name,
        domain: editForm.domain,
        da: parseInt(editForm.da) || 0,
        sitemapUrl: editForm.sitemapUrl || null,
        locationId: parseInt(editForm.locationId) || 2124,
      }),
    });
    setEditing(false);
    fetchClient();
  };

  const handleUploadOnboarding = async () => {
    if (!onboardingText.trim()) return;
    setUploading(true);
    await fetch(`/api/clients/${id}/onboarding`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: onboardingText }),
    });
    setUploading(false);
    setOnboardingText("");
    fetchClient();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setOnboardingText(text);
  };

  const handleScanPages = async () => {
    setScanning(true);
    setScanError(null);
    const res = await fetch(`/api/clients/${id}/scan-pages`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setScanError(data.error || `Failed (${res.status})`);
      setShowPaste(true);
    }
    setScanning(false);
    fetchClient();
  };

  const handlePasteUrls = async () => {
    const urls = pasteUrls.split("\n").map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) return;
    setScanError(null);
    const res = await fetch(`/api/clients/${id}/scan-pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setScanError(data.error || `Failed (${res.status})`);
    } else {
      setPasteUrls("");
      setShowPaste(false);
    }
    fetchClient();
  };

  const handleCreateSession = async () => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: id, scope: newScope }),
    });
    if (res.ok) {
      const session = await res.json();
      setSessionDialogOpen(false);
      window.location.href = `/clients/${id}/sessions/${session.id}`;
    }
  };

  if (loading || !client) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  const locationLabel = (lid: number) => {
    if (lid === 2124) return "Canada";
    if (lid === 2840) return "US";
    if (lid === 0) return "Anywhere";
    return `Location ${lid}`;
  };

  let parsedSummary: Record<string, string | string[]> | null = null;
  if (client.onboardingSummary) {
    try { parsedSummary = JSON.parse(client.onboardingSummary); } catch { /* not JSON */ }
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
        <a href="/clients" className="hover:text-foreground">Clients</a>
        <span>/</span>
        <span className="text-foreground">{client.name}</span>
      </div>

      {/* Client Info */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{client.name}</span>
            <Button variant="outline" size="sm" onClick={() => setEditing(!editing)}>
              {editing ? "Cancel" : "Edit"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Name</Label>
                  <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                </div>
                <div>
                  <Label>Domain</Label>
                  <Input value={editForm.domain} onChange={(e) => setEditForm({ ...editForm, domain: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>DA</Label>
                  <Input type="number" value={editForm.da} onChange={(e) => setEditForm({ ...editForm, da: e.target.value })} />
                </div>
                <div>
                  <Label>Sitemap URL</Label>
                  <Input value={editForm.sitemapUrl} onChange={(e) => setEditForm({ ...editForm, sitemapUrl: e.target.value })} placeholder="domain.com/sitemap.xml" />
                </div>
                <div>
                  <Label>Location</Label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                    value={editForm.locationId}
                    onChange={(e) => setEditForm({ ...editForm, locationId: e.target.value })}
                  >
                    <option value="2124">Canada (2124)</option>
                    <option value="2840">US (2840)</option>
                    <option value="0">Anywhere (0)</option>
                  </select>
                </div>
              </div>
              <Button onClick={handleEdit}>Save</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-4 text-sm">
              <div><span className="text-muted-foreground">Domain:</span> {client.domain}</div>
              <div><span className="text-muted-foreground">DA:</span> {client.da}</div>
              <div><span className="text-muted-foreground">Location:</span> {locationLabel(client.locationId)}</div>
              {client.sitemapUrl && <div><span className="text-muted-foreground">Sitemap:</span> {client.sitemapUrl}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Onboarding Doc */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Onboarding Document</CardTitle>
        </CardHeader>
        <CardContent>
          {client.onboardingDoc && client.onboardingSummary && parsedSummary ? (
            <div>
              <Badge variant="default" className="mb-3">Summary generated</Badge>
              <div className="grid gap-2 text-sm">
                {parsedSummary.services && (
                  <div><span className="text-muted-foreground">Services:</span> {(parsedSummary.services as string[]).join(", ")}</div>
                )}
                {parsedSummary.locations && (
                  <div><span className="text-muted-foreground">Locations:</span> {(parsedSummary.locations as string[]).join(", ")}</div>
                )}
                {parsedSummary.service_geography && (
                  <div><span className="text-muted-foreground">Geography:</span> {parsedSummary.service_geography as string}</div>
                )}
                {parsedSummary.competitors && (
                  <div><span className="text-muted-foreground">Competitors:</span> {(parsedSummary.competitors as string[]).join(", ")}</div>
                )}
                {parsedSummary.differentiators && (
                  <div><span className="text-muted-foreground">Differentiators:</span> {(parsedSummary.differentiators as string[]).join(", ")}</div>
                )}
                {parsedSummary.guardrails && (
                  <div><span className="text-muted-foreground">Guardrails:</span> {(parsedSummary.guardrails as string[]).join(", ")}</div>
                )}
              </div>
              <Separator className="my-3" />
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">View raw document</summary>
                <pre className="mt-2 whitespace-pre-wrap max-h-48 overflow-y-auto">{client.onboardingDoc}</pre>
              </details>
            </div>
          ) : client.onboardingDoc && !client.onboardingSummary ? (
            <div>
              <Badge variant="outline" className="animate-pulse">Generating summary...</Badge>
              <p className="text-sm text-muted-foreground mt-2">Claude Sonnet is extracting structured data from the onboarding doc.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Upload a .txt onboarding document to enable keyword research.</p>
              <input type="file" accept=".txt" onChange={handleFileUpload} className="text-sm" />
              {onboardingText && (
                <>
                  <Textarea
                    value={onboardingText}
                    onChange={(e) => setOnboardingText(e.target.value)}
                    rows={8}
                    placeholder="Paste or upload onboarding doc content..."
                  />
                  <Button onClick={handleUploadOnboarding} disabled={uploading}>
                    {uploading ? "Uploading..." : "Upload & Generate Summary"}
                  </Button>
                </>
              )}
              {!onboardingText && (
                <>
                  <p className="text-xs text-muted-foreground">Or paste directly:</p>
                  <Textarea
                    value={onboardingText}
                    onChange={(e) => setOnboardingText(e.target.value)}
                    rows={6}
                    placeholder="Paste onboarding doc content..."
                  />
                  {onboardingText && (
                    <Button onClick={handleUploadOnboarding} disabled={uploading}>
                      {uploading ? "Uploading..." : "Upload & Generate Summary"}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Existing Pages */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Existing Pages ({client.pages.length})</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setShowPaste(!showPaste); setScanError(null); }}>
                {showPaste ? "Cancel" : "Paste URLs"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleScanPages} disabled={scanning}>
                {scanning ? "Scanning..." : "Scan Sitemap"}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scanError && (
            <div className="mb-3 text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {scanError}
            </div>
          )}
          {showPaste && (
            <div className="mb-4 space-y-2">
              <p className="text-xs text-muted-foreground">Paste URLs one per line (Screaming Frog export, sitemap.xml copy, etc.)</p>
              <textarea
                value={pasteUrls}
                onChange={(e) => setPasteUrls(e.target.value)}
                rows={8}
                placeholder={"https://example.com/services/\nhttps://example.com/about/\nhttps://example.com/contact/"}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              />
              <Button size="sm" onClick={handlePasteUrls} disabled={!pasteUrls.trim()}>
                Import {pasteUrls.split("\n").filter((u) => u.trim()).length} URLs
              </Button>
            </div>
          )}
          {client.pages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pages loaded. Optional - used to avoid suggesting keywords that already have pages and to flag cannibalization. Research still works without it.
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1">
              {client.pages.map((page) => (
                <div key={page.id} className="text-sm flex items-center gap-2">
                  <span className="text-muted-foreground truncate max-w-[400px]">{page.url}</span>
                  {page.inferredKeyword && <Badge variant="outline" className="text-xs shrink-0">{page.inferredKeyword}</Badge>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Research Sessions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Research Sessions</span>
            <Dialog open={sessionDialogOpen} onOpenChange={setSessionDialogOpen}>
              <DialogTrigger
                className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-medium h-7 px-2.5 hover:bg-primary/80 transition-colors disabled:pointer-events-none disabled:opacity-50"
                disabled={!client.onboardingSummary}
              >
                New Session
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New Research Session</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Scope</Label>
                    <Input
                      value={newScope}
                      onChange={(e) => setNewScope(e.target.value)}
                      placeholder='e.g. "10 BOF keywords" or "5 BOF + 3 MOF"'
                    />
                    <p className="text-xs text-muted-foreground mt-1">Define how many keywords and what funnel stages.</p>
                  </div>
                  <Button onClick={handleCreateSession} className="w-full">Create Session</Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!client.onboardingSummary && (
            <p className="text-sm text-muted-foreground">Upload an onboarding document first to enable research sessions.</p>
          )}
          {client.sessions.length === 0 && client.onboardingSummary && (
            <p className="text-sm text-muted-foreground">No sessions yet. Create one to start keyword research.</p>
          )}
          {client.sessions.length > 0 && (
            <div className="space-y-2">
              {client.sessions.map((session) => {
                const scopeMatch = session.scope.match(/(\d+)/);
                const scopeTarget = scopeMatch ? parseInt(scopeMatch[1]) : 0;
                const approved = session.candidates.length;
                return (
                  <a
                    key={session.id}
                    href={`/clients/${id}/sessions/${session.id}`}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                  >
                    <div>
                      <div className="font-medium text-sm">{session.scope}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(session.createdAt).toLocaleDateString()} - {session._count.candidates} candidates, {session._count.analyses} analyzed
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{approved}/{scopeTarget}</span>
                      <Badge variant={session.status === "completed" ? "default" : "outline"} className="text-xs">
                        {session.status}
                      </Badge>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
