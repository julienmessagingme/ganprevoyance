"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast, Toaster } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BuilderClient } from "../../dashboards/[id]/builder-client";
import { CampaignEditorDialog } from "../campaign-editor-dialog";
import type { CampaignWithRefs } from "@/lib/campaigns/types";

/**
 * Page d'édition d'une campagne. La campagne possède un dashboard 1:1
 * (cf. migration 010) : on délègue la construction du funnel au
 * `BuilderClient` existant, en lui passant `campaignId` pour activer
 * son mode campagne (palette strict, bouton "Modifier les briques",
 * lien retour /campaigns).
 *
 * Pour les campagnes créées avant la Phase 21, le `dashboard_id` est
 * absent — on appelle alors `POST /api/campaigns/[id]/ensure-dashboard`
 * pour en créer un à la volée.
 */
export function CampaignPageClient({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [campaign, setCampaign] = useState<CampaignWithRefs | null>(null);
  const [dashboardId, setDashboardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refsEditorOpen, setRefsEditorOpen] = useState(false);
  /** Bumped à chaque fois que les briques de la campagne sont modifiées,
   *  pour forcer le builder à refetch et recalculer son campaignKeySet. */
  const [refsVersion, setRefsVersion] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/campaigns/${campaignId}`);
      if (r.status === 404) {
        toast.error("Campagne introuvable");
        router.replace("/campaigns");
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { campaign: c } = (await r.json()) as { campaign: CampaignWithRefs };
      setCampaign(c);

      // Migration douce des campagnes pré-Phase-21 : si la campagne n'a
      // pas encore son dashboard, on le crée à la volée. L'API est
      // idempotente, donc une concurrence éventuelle ne fait pas de mal.
      if (c.dashboard_id) {
        setDashboardId(c.dashboard_id);
      } else if (c.can_edit) {
        const ensureRes = await fetch(
          `/api/campaigns/${campaignId}/ensure-dashboard`,
          { method: "POST" }
        );
        if (ensureRes.ok) {
          const { dashboard_id } = (await ensureRes.json()) as {
            dashboard_id: string;
          };
          setDashboardId(dashboard_id);
        } else {
          toast.error("Impossible de créer le tableau de la campagne");
        }
      } else {
        // Campagne partagée pré-Phase-21 dont je ne suis pas owner →
        // je ne peux pas créer le dashboard. Cas rare ; on bloque proprement.
        toast.error(
          "Cette campagne n'a pas encore de tableau et seul son auteur peut le créer."
        );
      }
    } catch {
      toast.error("Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [campaignId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  function patchCampaign(body: Record<string, unknown>) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        const r = await fetch(`/api/campaigns/${campaignId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch {
        toast.error("Erreur d'enregistrement");
      } finally {
        setSaving(false);
      }
    }, 500);
  }

  function updateName(name: string) {
    setCampaign((c) => (c ? { ...c, name } : c));
    patchCampaign({ name });
  }

  function updateShared(is_shared: boolean) {
    setCampaign((c) => (c ? { ...c, is_shared } : c));
    patchCampaign({ is_shared });
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Toaster richColors position="top-right" />
        <p className="text-zinc-500">Chargement…</p>
      </div>
    );
  }
  if (!campaign) return null;

  return (
    <div className="space-y-4">
      <Toaster richColors position="top-right" />

      {/* Carte méta de la campagne (nom + partagée). Le builder en dessous
          gère la période, les étapes et la viz du tableau lié. */}
      <div className="bg-amber-50/40 border border-amber-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase text-amber-800 font-semibold tracking-wide">
            Campagne
          </p>
          {saving && (
            <span className="text-xs text-zinc-500">Enregistrement…</span>
          )}
        </div>
        <Input
          value={campaign.name}
          onChange={(e) => updateName(e.target.value)}
          disabled={!campaign.can_edit}
          className="text-lg font-semibold bg-white"
          placeholder="Nom de la campagne"
        />
        <div className="flex items-center gap-2">
          <input
            id="shared-toggle"
            type="checkbox"
            checked={campaign.is_shared}
            onChange={(e) => updateShared(e.target.checked)}
            disabled={!campaign.can_edit}
            className="h-4 w-4"
          />
          <Label htmlFor="shared-toggle" className="cursor-pointer text-sm">
            Partagée avec l&apos;école
          </Label>
          <span className="text-xs text-zinc-500">
            {campaign.is_shared
              ? "Visible par tous les utilisateurs"
              : "Visible uniquement par vous"}
          </span>
        </div>
      </div>

      {/* Builder du tableau lié — mode campagne (palette strict). */}
      {dashboardId ? (
        <BuilderClient
          dashboardId={dashboardId}
          campaignId={campaignId}
          onEditCampaignRefs={() => setRefsEditorOpen(true)}
          campaignRefsVersion={refsVersion}
        />
      ) : (
        <p className="text-zinc-500 text-sm">
          Tableau non disponible pour cette campagne.
        </p>
      )}

      {/* Dialog de modification des briques (réutilise CampaignEditorDialog
          existant en mode "edit"). On bump refsVersion à la fermeture pour
          forcer le builder à refetch sa palette filtrée. */}
      {refsEditorOpen && (
        <CampaignEditorDialog
          mode="edit"
          campaignId={campaignId}
          open
          onOpenChange={(o) => {
            if (!o) {
              setRefsEditorOpen(false);
              setRefsVersion((v) => v + 1);
              void load(); // refresh méta (au cas où on a aussi changé nom/partagée)
            }
          }}
        />
      )}
    </div>
  );
}
