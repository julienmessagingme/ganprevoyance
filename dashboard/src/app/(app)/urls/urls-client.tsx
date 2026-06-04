"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Copy, MoreHorizontal } from "lucide-react";
import { toast, Toaster } from "sonner";
import { NewEventDialog } from "./new-event-dialog";
import { EditDestinationDialog } from "./edit-destination-dialog";
import { VersionsDialog } from "./versions-dialog";
import { SubNavStats } from "../sub-nav-stats";

export interface EventRow {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  currentVersion: {
    id: string;
    destination_url: string;
    version: number;
    active_from: string;
  } | null;
  clickCount: number;
  lastClickAt: string | null;
}

export function UrlsClient({ publicBaseUrl }: { publicBaseUrl: string }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [openNew, setOpenNew] = useState(false);
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [viewingVersionsOf, setViewingVersionsOf] = useState<EventRow | null>(
    null
  );

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/events");
      const j = await r.json();
      setEvents(j.events ?? []);
    } catch {
      toast.error("Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function copyShortUrl(slug: string) {
    try {
      await navigator.clipboard.writeText(`${publicBaseUrl}/r/${slug}`);
      toast.success("URL copiée");
    } catch {
      toast.error("Impossible de copier");
    }
  }

  async function archive(ev: EventRow) {
    if (!confirm(`Archiver « ${ev.name} » ? Le redirect cessera de fonctionner.`))
      return;
    const r = await fetch(`/api/events/${ev.id}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("Archivé");
      load();
    } else {
      toast.error("Erreur");
    }
  }

  async function rename(ev: EventRow) {
    const name = prompt("Nouveau nom :", ev.name);
    if (!name || name === ev.name) return;
    const r = await fetch(`/api/events/${ev.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (r.ok) {
      toast.success("Renommé");
      load();
    } else {
      toast.error("Erreur");
    }
  }

  return (
    <div className="space-y-4">
      <Toaster richColors position="top-right" />
      <header className="flex justify-between items-center">
        <SubNavStats />
        <Button onClick={() => setOpenNew(true)}>+ Nouvel événement</Button>
      </header>

      <h2 className="text-xl font-semibold">Mes URLs trackées</h2>

      {loading ? (
        <p className="text-zinc-500">Chargement…</p>
      ) : events.length === 0 ? (
        <p className="text-zinc-500">
          Aucune URL pour cette école. Cliquez sur « + Nouvel événement ».
        </p>
      ) : (
        <div className="space-y-3">
          {events.map((ev) => (
            <Card key={ev.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium">{ev.name}</h3>
                  <div className="text-sm text-zinc-600 flex items-center gap-2 mt-1">
                    <code className="bg-zinc-100 px-2 py-0.5 rounded text-xs break-all">
                      {publicBaseUrl}/r/{ev.slug}
                    </code>
                    <button
                      onClick={() => copyShortUrl(ev.slug)}
                      className="hover:bg-zinc-100 p-1 rounded shrink-0"
                      aria-label="Copier l'URL"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="text-sm text-zinc-500 mt-1 truncate">
                    →{" "}
                    {ev.currentVersion?.destination_url ?? "(aucune destination)"}
                    {ev.currentVersion && (
                      <span className="ml-2 text-xs text-zinc-400">
                        v{ev.currentVersion.version}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-400 mt-1">
                    {ev.clickCount} clic{ev.clickCount !== 1 ? "s" : ""}
                    {ev.lastClickAt &&
                      ` · dernier clic ${new Date(ev.lastClickAt).toLocaleString(
                        "fr-FR"
                      )}`}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="p-1.5 rounded hover:bg-zinc-100"
                    aria-label="Actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditing(ev)}>
                      Modifier la destination
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => rename(ev)}>
                      Renommer
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setViewingVersionsOf(ev)}
                    >
                      Historique des versions
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => archive(ev)}
                      className="text-red-600"
                    >
                      Archiver
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          ))}
        </div>
      )}

      <NewEventDialog
        open={openNew}
        onOpenChange={setOpenNew}
        onCreated={load}
      />
      <EditDestinationDialog
        event={editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
      <VersionsDialog
        event={viewingVersionsOf}
        onOpenChange={(o) => !o && setViewingVersionsOf(null)}
      />
    </div>
  );
}
