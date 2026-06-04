"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Trash2, Share2, Lock } from "lucide-react";
import { SubNavStats } from "../sub-nav-stats";
import { NewDashboardDialog } from "./new-dashboard-dialog";
import type { Dashboard } from "@/lib/dashboards/types";

export function DashboardsClient() {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [openNew, setOpenNew] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/dashboards");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { dashboards: Dashboard[] };
      setDashboards(j.dashboards ?? []);
    } catch {
      toast.error("Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function remove(d: Dashboard) {
    if (!confirm(`Supprimer « ${d.name} » ?`)) return;
    const r = await fetch(`/api/dashboards/${d.id}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("Supprimé");
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
        <Button onClick={() => setOpenNew(true)}>+ Nouveau funnel</Button>
      </header>

      <h2 className="text-xl font-semibold">Mes tableaux</h2>

      {loading ? (
        <p className="text-zinc-500">Chargement…</p>
      ) : dashboards.length === 0 ? (
        <p className="text-zinc-500">
          Aucun tableau pour cette école. Cliquez sur « + Nouveau funnel ».
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {dashboards.map((d) => {
            const typeLabel = d.type === "pie" ? "Pie chart" : "Funnel";
            return (
              <Card key={d.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/dashboards/${d.id}`}
                    className="flex-1 min-w-0 hover:underline"
                  >
                    <h3 className="font-medium truncate">{d.name}</h3>
                    <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1.5">
                      <span>{typeLabel}</span>
                      <span>·</span>
                      {d.is_shared ? (
                        <span className="inline-flex items-center gap-1">
                          <Share2 className="h-3 w-3" /> Partagé
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Lock className="h-3 w-3" /> Privé
                        </span>
                      )}
                      <span>·</span>
                      <span>
                        modifié le{" "}
                        {new Date(d.updated_at).toLocaleDateString("fr-FR")}
                      </span>
                    </p>
                  </Link>
                  {d.can_edit && (
                    <button
                      onClick={() => remove(d)}
                      className="text-zinc-400 hover:text-red-600 p-1"
                      aria-label="Supprimer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <NewDashboardDialog open={openNew} onOpenChange={setOpenNew} />
    </div>
  );
}
