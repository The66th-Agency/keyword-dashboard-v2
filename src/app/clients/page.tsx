"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface Client {
  id: string;
  name: string;
  domain: string;
  da: number;
  locationId: number;
  onboardingSummary: string | null;
  _count: { sessions: number; pages: number };
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: "", domain: "" });

  const fetchClients = async () => {
    const res = await fetch("/api/clients");
    const data = await res.json();
    setClients(data);
    setLoading(false);
  };

  useEffect(() => { fetchClients(); }, []);

  const handleCreate = async () => {
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, domain: form.domain }),
    });
    if (res.ok) {
      setForm({ name: "", domain: "" });
      setDialogOpen(false);
      fetchClients();
      // Poll briefly to pick up DA once the Site Profiler call resolves
      setTimeout(fetchClients, 4000);
      setTimeout(fetchClients, 8000);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this client and all associated data?")) return;
    await fetch(`/api/clients/${id}`, { method: "DELETE" });
    fetchClients();
  };

  const locationLabel = (id: number) => {
    if (id === 2124) return "Canada";
    if (id === 2840) return "US";
    if (id === 0) return "Anywhere";
    return `Location ${id}`;
  };

  if (loading) {
    return <div className="text-muted-foreground">Loading clients...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-medium h-8 px-2.5 hover:bg-primary/80 transition-colors">
            New Client
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Client</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Client name" />
              </div>
              <div>
                <Label>Domain</Label>
                <Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="example.com" />
              </div>
              <p className="text-xs text-muted-foreground">DA will be fetched automatically from Mangools after creation.</p>
              <Button onClick={handleCreate} className="w-full">Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {clients.length === 0 ? (
        <p className="text-muted-foreground">No clients yet. Create one to get started.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => (
            <Card key={client.id} className="group relative">
              <a href={`/clients/${client.id}`} className="absolute inset-0 z-10" />
              <CardHeader className="pb-2">
                <CardTitle className="text-lg flex items-center justify-between">
                  <span>{client.name}</span>
                  {client.da > 0 ? (
                    <Badge variant="secondary" className="text-xs">DA {client.da}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs animate-pulse">DA fetching...</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-2">{client.domain}</p>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>{client._count.sessions} sessions</span>
                  <span>{client._count.pages} pages</span>
                  <span>{locationLabel(client.locationId)}</span>
                </div>
                <div className="mt-2">
                  {client.onboardingSummary ? (
                    <Badge variant="default" className="text-xs">Onboarded</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">No onboarding doc</Badge>
                  )}
                </div>
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(client.id); }}
                  className="absolute top-3 right-3 z-20 text-xs text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Delete
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
