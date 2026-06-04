"use client";

import { useEffect, useState } from "react";
import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast, Toaster } from "sonner";
import { EventAccordion } from "./event-accordion";
import { RedirectAccordion } from "./redirect-accordion";
import { SubNavStats } from "../sub-nav-stats";

import type { MetaCostBreakdownItem } from "@/lib/dashboards/types";

interface MmEventListItem {
  school_slug: string;
  school_name: string;
  event_ns: string;
  name: string;
  description: string | null;
  count: number;
  /** Renseigné uniquement pour les events porteurs (text_label non vide). */
  meta_cost_eur?: number;
  meta_breakdown?: MetaCostBreakdownItem[];
}

interface RedirectListItem {
  id: string;
  slug: string;
  name: string;
  school_slug: string;
  school_name: string;
  count: number;
}

interface SyncState {
  school_slug?: string;
  event_ns: string;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_error: string | null;
}

function presetDates(days: number) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days + 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

export function StatsClient() {
  const [{ from, to }, setRange] = useState(() => presetDates(30));
  const [events, setEvents] = useState<MmEventListItem[]>([]);
  const [redirects, setRedirects] = useState<RedirectListItem[]>([]);
  const [syncs, setSyncs] = useState<SyncState[]>([]);
  const [loading, setLoading] = useState(false);
  const [resyncing, setResyncing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [evRes, urlRes] = await Promise.all([
        fetch(`/api/stats/custom-events?from=${from}&to=${to}`),
        fetch(`/api/stats/redirects?from=${from}&to=${to}`),
      ]);
      const evJson = (await evRes.json()) as {
        events?: MmEventListItem[];
        syncs?: SyncState[];
      };
      const urlJson = (await urlRes.json()) as {
        redirects?: RedirectListItem[];
      };
      setEvents(evJson.events ?? []);
      setSyncs(evJson.syncs ?? []);
      setRedirects(urlJson.redirects ?? []);
    } catch {
      toast.error("Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [from, to]);

  async function manualResync() {
    setResyncing(true);
    const r = await fetch("/api/admin/sync", { method: "POST" });
    setResyncing(false);
    if (r.ok) {
      toast.success("Sync terminé");
      load();
    } else {
      toast.error("Erreur sync");
    }
  }

  const lastSync = syncs.reduce<string | null>((acc, s) => {
    if (!s.last_run_at) return acc;
    if (!acc || s.last_run_at > acc) return s.last_run_at;
    return acc;
  }, null);

  const errorEvents = syncs.filter((s) => s.last_run_status === "error");

  return (
    <div className="space-y-4">
      <Toaster richColors position="top-right" />
      <header className="flex justify-between items-center">
        <SubNavStats />
      </header>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1">
          <Label htmlFor="from">Du</Label>
          <Input
            id="from"
            type="date"
            value={from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to">Au</Label>
          <Input
            id="to"
            type="date"
            value={to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            className="w-40"
          />
        </div>
        <Button variant="outline" onClick={() => setRange(presetDates(7))}>
          7j
        </Button>
        <Button variant="outline" onClick={() => setRange(presetDates(30))}>
          30j
        </Button>
        <Button variant="outline" onClick={() => setRange(presetDates(90))}>
          90j
        </Button>
      </div>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Custom events MessagingMe</h2>
        {loading ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : events.length === 0 ? (
          <p className="text-zinc-500">
            Aucun custom event pour cette école. Lancez un sync via le bouton ⟳ en bas de page.
          </p>
        ) : (
          <Accordion multiple className="space-y-2">
            {events.map((ev) => (
              <EventAccordion
                key={`${ev.school_slug}:${ev.event_ns}`}
                ev={ev}
                from={from}
                to={to}
              />
            ))}
          </Accordion>
        )}
      </section>

      <section className="space-y-2 pt-4">
        <h2 className="text-xl font-semibold">Clics URL trackées</h2>
        {loading ? (
          <p className="text-zinc-500">Chargement…</p>
        ) : redirects.length === 0 ? (
          <p className="text-zinc-500">
            Aucune URL trackée pour cette école. Créez-en une dans l&apos;onglet URLs.
          </p>
        ) : (
          <Accordion multiple className="space-y-2">
            {redirects.map((r) => (
              <RedirectAccordion key={r.id} redirect={r} from={from} to={to} />
            ))}
          </Accordion>
        )}
      </section>

      <footer className="text-xs text-zinc-500 flex items-center gap-4 pt-4 border-t">
        <span>
          Dernier sync MessagingMe :{" "}
          {lastSync ? new Date(lastSync).toLocaleString("fr-FR") : "—"}
          {errorEvents.length > 0 && (
            <span className="ml-2 text-red-600">
              ⚠️ {errorEvents.length} erreur
              {errorEvents.length !== 1 ? "s" : ""}
            </span>
          )}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={manualResync}
          disabled={resyncing}
        >
          {resyncing ? "Sync en cours…" : "⟳ Re-sync"}
        </Button>
      </footer>
    </div>
  );
}
