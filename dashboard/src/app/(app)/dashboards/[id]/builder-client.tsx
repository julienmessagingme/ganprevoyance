"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Trash2,
  X,
  Plus,
  GripVertical,
  Download,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SubNavStats } from "../../sub-nav-stats";
import { FunnelChart } from "./funnel-chart";
import { FancyFunnelChart } from "./funnel-chart-fancy";
import { FunnelTable } from "./funnel-table";
import { PieChartViz } from "./pie-chart";
import { PieTable } from "./pie-table";
import {
  exportFunnelToExcel,
  exportFunnelToPDF,
} from "@/lib/dashboards/export";

type FunnelView = "bar" | "funnel";
const VIEW_STORAGE_KEY = "edh_funnel_view";
import type {
  DashboardWithSteps,
  DashboardStep,
  StepRef,
  Palette,
  PaletteItem,
  DatePreset,
  ComputedDashboardData,
  CampaignCostSummary,
} from "@/lib/dashboards/types";
import { MetaCostButton } from "@/components/meta-cost-breakdown";
import type {
  CampaignListItem,
  CampaignWithRefs,
} from "@/lib/campaigns/types";
import { paletteKeyOf } from "@/lib/campaigns/utils";

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "7d", label: "7j" },
  { key: "30d", label: "30j" },
  { key: "90d", label: "90j" },
];

const STEPS_ZONE_ID = "steps-zone";
const PALETTE_PREFIX = "palette:";

interface PendingRef {
  step_type: "mm_event" | "url_click";
  event_ns?: string;
  redirect_event_id?: string;
  /** École d'origine du mm_event. NULL en single-school (champ legacy
   *  conservé pour compat avec le schéma DB partagé). */
  event_school_slug?: string;
}

interface PendingStep {
  label: string | null;
  refs: PendingRef[];
}

function tmpId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function stepsToPending(steps: DashboardStep[]): PendingStep[] {
  return steps.map((s) => ({
    label: s.label && s.label.trim() ? s.label : null,
    refs: s.refs.map((r) =>
      r.step_type === "mm_event"
        ? {
            step_type: "mm_event" as const,
            event_ns: r.event_ns!,
            ...(r.event_school_slug
              ? { event_school_slug: r.event_school_slug }
              : {}),
          }
        : {
            step_type: "url_click" as const,
            redirect_event_id: r.redirect_event_id!,
          }
    ),
  }));
}

function paletteItemFor(palette: Palette, refId: string): PaletteItem | null {
  return (
    palette.mmEvents.find((p) => p.ref_id === refId) ??
    palette.redirectEvents.find((p) => p.ref_id === refId) ??
    null
  );
}

export interface BuilderClientProps {
  dashboardId: string;
  /** Si fourni, le builder fonctionne en "mode campagne" :
   *  - palette strictement limitée aux briques de la campagne (pas de
   *    select "Tout") ;
   *  - bouton "Modifier les briques" qui ouvre la dialog de refs ;
   *  - header "Tableau de la campagne X" + lien retour /campaigns au lieu
   *    de /dashboards ;
   *  - suppression désactivée côté builder (passer par /campaigns). */
  campaignId?: string;
  /** Callback invoqué quand l'utilisateur veut modifier la liste des
   *  briques de la campagne. Fourni en mode campagne uniquement. */
  onEditCampaignRefs?: () => void;
  /** Refs courantes de la campagne (passées par la page parente),
   *  utilisées pour calculer le campaignKeySet sans refetch. */
  campaignRefsVersion?: number;
}

export function BuilderClient({
  dashboardId,
  campaignId,
  onEditCampaignRefs,
  campaignRefsVersion,
}: BuilderClientProps) {
  const router = useRouter();
  const isCampaignMode = !!campaignId;
  const [dashboard, setDashboard] = useState<DashboardWithSteps | null>(null);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  /** id de la campagne choisie comme filtre, ou null pour "Tout". Le filtre
   *  agit uniquement sur l'affichage de la palette (aside + AddRefMenu) ;
   *  les refs déjà dans les étapes restent visibles inchangées. En mode
   *  campagne, le filtre est verrouillé sur `campaignId` (cf. effet plus bas). */
  const [campaignFilter, setCampaignFilter] = useState<string | null>(
    campaignId ?? null
  );
  const [campaignKeySet, setCampaignKeySet] = useState<Set<string> | null>(
    null
  );
  /** Bumpé localement après une modif via le RoleEventSelect inline.
   *  S'ajoute au `campaignRefsVersion` externe pour forcer le refetch
   *  des refs de la campagne (et donc la mise à jour de campaignKeySet
   *  → palette body filtered). */
  const [localRefsBump, setLocalRefsBump] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeDrag, setActiveDrag] = useState<{
    kind: "palette" | "step";
    label: string;
  } | null>(null);
  const [computed, setComputed] = useState<ComputedDashboardData | null>(null);
  const [computing, setComputing] = useState(false);
  const [computeError, setComputeError] = useState(false);
  const [view, setView] = useState<FunnelView>("bar");
  // Collapse/expand des 2 premières colonnes du builder pour laisser
  // plus de place à la viz. Persisté en localStorage (par navigateur,
  // pas par tableau — on garde la pref globale de l'utilisateur).
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [stepsCollapsed, setStepsCollapsed] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataAbort = useRef<AbortController | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  // Restore the persisted view choice on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "bar" || stored === "funnel") setView(stored);
    if (window.localStorage.getItem("edh_palette_collapsed") === "1") {
      setPaletteCollapsed(true);
    }
    if (window.localStorage.getItem("edh_steps_collapsed") === "1") {
      setStepsCollapsed(true);
    }
  }, []);

  function togglePalette() {
    setPaletteCollapsed((v) => {
      const next = !v;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("edh_palette_collapsed", next ? "1" : "0");
      }
      return next;
    });
  }
  function toggleSteps() {
    setStepsCollapsed((v) => {
      const next = !v;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("edh_steps_collapsed", next ? "1" : "0");
      }
      return next;
    });
  }

  function changeView(next: FunnelView) {
    setView(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  /** Fetch /data — toujours appelé APRÈS un load() ou un PATCH réussi
   *  pour éviter les races (le PATCH n'est pas encore commit côté DB
   *  quand /data lit la DB en parallèle). */
  const fetchData = useCallback(async () => {
    dataAbort.current?.abort();
    const ctrl = new AbortController();
    dataAbort.current = ctrl;
    setComputing(true);
    setComputeError(false);
    try {
      const r = await fetch(`/api/dashboards/${dashboardId}/data`, {
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as ComputedDashboardData;
      setComputed(j);
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      setComputeError(true);
    } finally {
      if (dataAbort.current === ctrl) setComputing(false);
    }
  }, [dashboardId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // On charge toujours la palette COMPLÈTE (sans `textOnly=true`).
      // Raison : `palette` est utilisée par `resolveRef` pour afficher
      // les labels des étapes DÉJÀ persistées. Si on la filtrait côté
      // serveur (events porteurs uniquement) en mode pie, les refs
      // existantes pointant vers des events non-porteurs ressortiraient
      // en "(indisponible)" alors qu'elles ont juste un label parfaitement
      // valide. Le filtre pie est donc appliqué côté client dans
      // `displayedPalette` (qui sert uniquement à l'affichage palette
      // sidebar + dropdown "+ Ajouter").
      const [dRes, pRes, cRes] = await Promise.all([
        fetch(`/api/dashboards/${dashboardId}`),
        fetch(`/api/dashboards/palette`),
        fetch(`/api/campaigns`),
      ]);
      if (dRes.status === 404) {
        toast.error("Tableau introuvable");
        router.replace("/dashboards");
        return;
      }
      if (!dRes.ok) throw new Error("HTTP");
      const dJson = (await dRes.json()) as { dashboard: DashboardWithSteps };
      if (!pRes.ok) throw new Error("HTTP");
      const pJson = (await pRes.json()) as Palette;
      setDashboard(dJson.dashboard);
      setPalette(pJson);
      // Campagnes : si l'API échoue (404, droits, etc.) on dégrade
      // silencieusement vers liste vide — le module est secondaire.
      // Inutile en mode campagne (palette déjà verrouillée).
      if (cRes.ok && !isCampaignMode) {
        const cJson = (await cRes.json()) as { campaigns: CampaignListItem[] };
        setCampaigns(cJson.campaigns ?? []);
      }
      // Charge la viz avec l'état DB courant.
      void fetchData();
    } catch {
      toast.error("Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, [dashboardId, router, fetchData, isCampaignMode]);

  useEffect(() => {
    void load();
  }, [load]);

  // Quand le filtre campagne change : fetch les refs de la campagne pour
  // construire le set de paletteKey autorisées. `null` = pas de filtre.
  // En mode campagne, le filtre est verrouillé sur `campaignId` et on
  // refetch aussi quand `campaignRefsVersion` bouge (signal de la page
  // parente après modif des briques).
  //
  // Filtrage par rôle : on ne garde QUE les refs `body` dans la palette.
  // Les refs `launch` et `failed` servent à calculer la synthèse coût
  // Meta, pas à être glissées en étapes (cf. Phase 25).
  useEffect(() => {
    if (!campaignFilter) {
      setCampaignKeySet(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/campaigns/${campaignFilter}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const { campaign } = (await r.json()) as { campaign: CampaignWithRefs };
        if (!alive) return;
        setCampaignKeySet(
          new Set(
            campaign.refs.filter((r) => r.role === "body").map(paletteKeyOf)
          )
        );
      } catch {
        if (!alive) return;
        toast.error("Erreur de chargement de la campagne");
        setCampaignKeySet(new Set()); // filtre vide → palette vide, plus parlant qu'un crash silencieux
      }
    })();
    return () => {
      alive = false;
    };
  }, [campaignFilter, campaignRefsVersion, localRefsBump]);

  const persist = useCallback(
    (body: Record<string, unknown>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        try {
          const r = await fetch(`/api/dashboards/${dashboardId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          // Refetch /data UNIQUEMENT après que le PATCH ait commité,
          // pour éviter la race où /data lit l'état d'avant le PATCH.
          void fetchData();
        } catch {
          toast.error("Erreur d'enregistrement");
        } finally {
          setSaving(false);
        }
      }, 500);
    },
    [dashboardId, fetchData]
  );

  function updateName(name: string) {
    setDashboard((d) => (d ? { ...d, name } : d));
    persist({ name });
  }

  function updatePreset(preset: DatePreset) {
    setDashboard((d) =>
      d
        ? {
            ...d,
            date_preset: preset,
            date_from: preset === "custom" ? d.date_from : null,
            date_to: preset === "custom" ? d.date_to : null,
          }
        : d
    );
    persist({
      date_preset: preset,
      date_from: preset === "custom" ? dashboard?.date_from ?? null : null,
      date_to: preset === "custom" ? dashboard?.date_to ?? null : null,
    });
  }

  function updateCustomDate(field: "date_from" | "date_to", value: string) {
    setDashboard((d) =>
      d ? { ...d, date_preset: "custom", [field]: value || null } : d
    );
    persist({
      date_preset: "custom",
      [field]: value || null,
    });
  }

  function setSteps(updater: (prev: DashboardStep[]) => DashboardStep[]) {
    setDashboard((d) => {
      if (!d) return d;
      const newSteps = updater(d.steps);
      persist({ steps: stepsToPending(newSteps) });
      return { ...d, steps: newSteps };
    });
  }

  function makeRef(p: PaletteItem, position: number): StepRef {
    // ref_id pour un mm_event est composite "<school>:<event_ns>" si l'item
    // porte une école (héritage du schéma multi-école). En single-school,
    // l'item n'a pas de school_slug → on prend ref_id tel quel.
    if (p.step_type === "mm_event") {
      const eventNs = p.school_slug
        ? p.ref_id.slice(p.school_slug.length + 1)
        : p.ref_id;
      return {
        id: tmpId("ref"),
        ref_position: position,
        step_type: "mm_event",
        event_ns: eventNs,
        redirect_event_id: null,
        event_school_slug: p.school_slug ?? null,
      };
    }
    return {
      id: tmpId("ref"),
      ref_position: position,
      step_type: "url_click",
      event_ns: null,
      redirect_event_id: p.ref_id,
      event_school_slug: null,
    };
  }

  function addNewStep(p: PaletteItem) {
    setSteps((prev) => [
      ...prev,
      {
        id: tmpId("step"),
        position: prev.length,
        label: null,
        refs: [makeRef(p, 0)],
      },
    ]);
  }

  function addRefToStep(stepIdx: number, p: PaletteItem) {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIdx
          ? { ...s, refs: [...s.refs, makeRef(p, s.refs.length)] }
          : s
      )
    );
  }

  function removeRefFromStep(stepIdx: number, refIdx: number) {
    setSteps((prev) => {
      const step = prev[stepIdx];
      const newRefs = step.refs.filter((_, i) => i !== refIdx);
      // Si on vient de retirer la dernière ref → supprimer l'étape entière.
      if (newRefs.length === 0) {
        return prev.filter((_, i) => i !== stepIdx);
      }
      return prev.map((s, i) =>
        i === stepIdx
          ? {
              ...s,
              refs: newRefs.map((r, ri) => ({ ...r, ref_position: ri })),
            }
          : s
      );
    });
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function setStepLabel(stepIdx: number, label: string) {
    setSteps((prev) =>
      prev.map((s, i) => (i === stepIdx ? { ...s, label } : s))
    );
  }

  function downloadExcel() {
    if (!dashboard || !computed) return;
    if (computed.steps.length === 0) {
      toast.error("Aucune donnée à exporter");
      return;
    }
    try {
      exportFunnelToExcel({
        dashboardName: dashboard.name,
        fromDate: computed.from,
        toDate: computed.to,
        steps: computed.steps,
        type: dashboard.type,
        campaignSummary: computed.campaign_summary ?? null,
      });
    } catch {
      toast.error("Erreur d'export Excel");
    }
  }

  async function downloadPDF() {
    if (!dashboard || !computed || !exportRef.current) return;
    if (computed.steps.length === 0) {
      toast.error("Aucune donnée à exporter");
      return;
    }
    setExporting(true);
    try {
      await exportFunnelToPDF({
        element: exportRef.current,
        dashboardName: dashboard.name,
        fromDate: computed.from,
        toDate: computed.to,
      });
    } catch {
      toast.error("Erreur d'export PDF");
    } finally {
      setExporting(false);
    }
  }

  async function deleteDashboard() {
    if (!dashboard) return;
    if (!confirm(`Supprimer définitivement « ${dashboard.name} » ?`)) return;
    const r = await fetch(`/api/dashboards/${dashboardId}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("Supprimé");
      router.push("/dashboards");
    } else {
      toast.error("Erreur");
    }
  }

  // Resolve label + availability + school chip for a single ref using the
  // local palette. L'identité d'un mm_event peut être composite
  // (school_slug, event_ns) en multi-école ; en single-school, juste event_ns.
  const resolveRef = useCallback(
    (
      r: StepRef
    ): {
      label: string;
      available: boolean;
      schoolName: string | null;
    } => {
      if (!palette)
        return { label: "…", available: true, schoolName: null };
      if (r.step_type === "mm_event") {
        const refId = r.event_school_slug
          ? `${r.event_school_slug}:${r.event_ns}`
          : r.event_ns!;
        const found = palette.mmEvents.find((p) => p.ref_id === refId);
        return found
          ? {
              label: found.label,
              available: true,
              schoolName: found.school_name ?? null,
            }
          : { label: "(indisponible)", available: false, schoolName: null };
      }
      const found = palette.redirectEvents.find(
        (p) => p.ref_id === r.redirect_event_id
      );
      return found
        ? {
            label: found.label,
            available: true,
            schoolName: found.school_name ?? null,
          }
        : { label: "(indisponible)", available: false, schoolName: null };
    },
    [palette]
  );

  // Compose the visible label of a step : explicit label, else "A + B + C".
  function stepDisplayLabel(s: DashboardStep): string {
    if (s.label && s.label.trim()) return s.label;
    if (s.refs.length === 0) return "(vide)";
    return s.refs.map((r) => resolveRef(r).label).join(" + ");
  }

  function handleDragStart(e: { active: { id: string | number } }) {
    if (!dashboard || !palette) return;
    const id = String(e.active.id);
    if (id.startsWith(PALETTE_PREFIX)) {
      const refId = id.slice(PALETTE_PREFIX.length);
      const p = paletteItemFor(palette, refId);
      if (p) setActiveDrag({ kind: "palette", label: p.label });
    } else {
      const step = dashboard.steps.find((s) => s.id === id);
      if (step) setActiveDrag({ kind: "step", label: stepDisplayLabel(step) });
    }
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveDrag(null);
    if (!dashboard || !palette) return;
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;

    // Drag from palette
    if (activeId.startsWith(PALETTE_PREFIX)) {
      const refId = activeId.slice(PALETTE_PREFIX.length);
      const p = paletteItemFor(palette, refId);
      if (!p) return;
      if (overId === STEPS_ZONE_ID) {
        addNewStep(p);
        return;
      }
      // overId might be a step id → add ref to that step
      const stepIdx = dashboard.steps.findIndex((s) => s.id === overId);
      if (stepIdx >= 0) {
        addRefToStep(stepIdx, p);
      } else {
        // Fallback : append as new step
        addNewStep(p);
      }
      return;
    }

    // Reorder existing steps
    if (activeId === overId) return;
    const oldIdx = dashboard.steps.findIndex((s) => s.id === activeId);
    const newIdx = dashboard.steps.findIndex((s) => s.id === overId);
    if (oldIdx < 0 || newIdx < 0) return;
    setSteps((prev) => arrayMove(prev, oldIdx, newIdx));
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <header className="flex justify-between items-center">
          <SubNavStats />
        </header>
        <p className="text-zinc-500">Chargement…</p>
      </div>
    );
  }
  if (!dashboard || !palette) return null;

  const stepIds = dashboard.steps.map((s) => s.id);

  // Palette filtrée pour l'affichage (sidebar + AddRefMenu). La palette complète
  // `palette` reste utilisée par `resolveRef`/`paletteItemFor` pour résoudre les
  // refs déjà présentes. Seul filtre d'affichage : la campagne courante.
  //
  // En mode pie, on montre TOUS les custom events (chaque part = un event, la
  // tranche = son nombre d'occurrences). On ne masque plus les events compteurs :
  // l'ancien filtre "porteurs de texte" (hérité d'EDH) les cachait à tort.
  let displayedPalette: Palette = palette;
  if (campaignKeySet) {
    displayedPalette = {
      mmEvents: displayedPalette.mmEvents.filter((p) =>
        campaignKeySet.has(p.ref_id)
      ),
      redirectEvents: displayedPalette.redirectEvents.filter((p) =>
        campaignKeySet.has(p.ref_id)
      ),
    };
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDrag(null)}
    >
      <div className="space-y-4">
        <Toaster richColors position="top-right" />
        <header className="flex justify-between items-center">
          <SubNavStats />
          <div className="flex items-center gap-3">
            {saving && (
              <span className="text-xs text-zinc-500">Enregistrement…</span>
            )}
            {isCampaignMode ? (
              <Button
                variant="outline"
                onClick={() => router.push("/campaigns")}
              >
                ← Campagnes
              </Button>
            ) : (
              <>
                {dashboard.can_edit !== false && (
                  <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={dashboard.is_shared}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setDashboard((d) =>
                          d ? { ...d, is_shared: next } : d
                        );
                        persist({ is_shared: next });
                      }}
                      className="h-3.5 w-3.5"
                    />
                    Partagé avec le domaine
                  </label>
                )}
                {dashboard.can_edit === false && (
                  <span className="text-xs text-zinc-500 italic">
                    Lecture seule (tableau partagé par un autre utilisateur)
                  </span>
                )}
                {dashboard.can_edit !== false && (
                  <Button variant="outline" onClick={deleteDashboard}>
                    <Trash2 className="h-4 w-4 mr-1" /> Supprimer
                  </Button>
                )}
              </>
            )}
          </div>
        </header>

        <div className="bg-white border rounded-lg p-4 space-y-3">
          <Input
            value={dashboard.name}
            onChange={(e) => updateName(e.target.value)}
            className="text-lg font-semibold"
            placeholder="Nom du tableau"
          />
          <div className="flex items-end gap-2 flex-wrap">
            {PRESETS.map((p) => (
              <Button
                key={p.key}
                size="sm"
                variant={dashboard.date_preset === p.key ? "default" : "outline"}
                onClick={() => updatePreset(p.key)}
              >
                {p.label}
              </Button>
            ))}
            <span className="text-zinc-400">·</span>
            <div className="space-y-1">
              <Label htmlFor="from" className="text-xs">
                Du
              </Label>
              <Input
                id="from"
                type="date"
                value={dashboard.date_from ?? ""}
                onChange={(e) => updateCustomDate("date_from", e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to" className="text-xs">
                Au
              </Label>
              <Input
                id="to"
                type="date"
                value={dashboard.date_to ?? ""}
                onChange={(e) => updateCustomDate("date_to", e.target.value)}
                className="w-40"
              />
            </div>
          </div>
        </div>

        {/* Synthèse coût Meta de la campagne (Phase 25) : affichée si le
            dashboard est lié à une campagne avec un launch défini.
            Donne le coût brut, le failed, les envois réussis et le coût
            net (cliquable → détail par pays). */}
        {computed?.campaign_summary && (
          <CampaignCostSummaryCard summary={computed.campaign_summary} />
        )}

        <div
          className="grid gap-4 transition-[grid-template-columns] duration-200 ease-out"
          style={{
            gridTemplateColumns: `${paletteCollapsed ? "44px" : "340px"} ${
              stepsCollapsed ? "44px" : "minmax(0,1fr)"
            } minmax(0,1.2fr)`,
          }}
        >
          {paletteCollapsed ? (
            <CollapsedPane label="Palette" onExpand={togglePalette} />
          ) : (
          <aside className="bg-white border rounded-lg p-3 space-y-4 max-h-[600px] overflow-auto relative">
            <button
              onClick={togglePalette}
              className="absolute top-2 right-2 text-zinc-400 hover:text-zinc-900 p-0.5"
              title="Réduire la palette"
              aria-label="Réduire la palette"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {isCampaignMode ? (
              <div>
                <p className="text-xs uppercase text-zinc-500 mb-1">
                  Briques de la campagne
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEditCampaignRefs?.()}
                  className="w-full"
                >
                  Modifier les briques
                </Button>
              </div>
            ) : (
              <div>
                <label className="text-xs uppercase text-zinc-500 block mb-1">
                  Filtrer
                </label>
                <select
                  value={campaignFilter ?? ""}
                  onChange={(e) => setCampaignFilter(e.target.value || null)}
                  className="w-full text-sm border rounded px-2 py-1 bg-white"
                >
                  <option value="">Tout (palette complète)</option>
                  {campaigns.length > 0 && (
                    <optgroup label="Par campagne">
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.is_shared && !c.can_edit ? " (partagée)" : ""}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            )}
            <div>
              <h4 className="text-xs uppercase text-zinc-500 mb-2">
                Custom events MM ({displayedPalette.mmEvents.length})
              </h4>
              <ul className="space-y-1">
                {displayedPalette.mmEvents.map((p) => (
                  <PaletteRow key={p.ref_id} item={p} />
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs uppercase text-zinc-500 mb-2">
                Clics URL ({displayedPalette.redirectEvents.length})
              </h4>
              <ul className="space-y-1">
                {displayedPalette.redirectEvents.map((p) => (
                  <PaletteRow key={p.ref_id} item={p} />
                ))}
              </ul>
            </div>
            {displayedPalette.mmEvents.length === 0 &&
              displayedPalette.redirectEvents.length === 0 && (
                <p className="text-xs text-zinc-500">
                  {campaignFilter
                    ? isCampaignMode
                      ? "Aucune brique dans cette campagne. Cliquez sur « Modifier les briques »."
                      : "Cette campagne ne contient aucune brique."
                    : "Aucun event disponible pour ce domaine."}
                </p>
              )}
          </aside>
          )}

          {stepsCollapsed ? (
            <CollapsedPane
              label={
                dashboard.type === "pie"
                  ? "Parts du pie chart"
                  : "Étapes du funnel"
              }
              onExpand={toggleSteps}
            />
          ) : (
          <StepsZone
            hasSteps={dashboard.steps.length > 0}
            title={
              dashboard.type === "pie" ? "Parts du pie chart" : "Étapes du funnel"
            }
            onCollapse={toggleSteps}
            topSlot={
              // En mode campagne avec un summary : event de LANCEMENT
              // en haut, AVANT les étapes du funnel (c'est lui qui
              // déclenche tout). Le failed est rendu en bas via bottomSlot.
              campaignId && computed?.campaign_summary ? (
                <CampaignRoleInline
                  label="Event de lancement"
                  role="launch"
                  campaignId={campaignId}
                  currentEventNs={computed.campaign_summary.launch.event_ns}
                  currentSchoolSlug={
                    computed.campaign_summary.launch.event_school_slug
                  }
                  items={palette.mmEvents.filter(
                    (p) => p.has_text_value === true
                  )}
                  emptyMessage="Aucun event porteur de tel disponible."
                  onChanged={async () => {
                    await fetchData();
                    setLocalRefsBump((v) => v + 1);
                  }}
                />
              ) : null
            }
            bottomSlot={
              campaignId && computed?.campaign_summary ? (
                <CampaignRoleInline
                  label="Event failed WhatsApp"
                  role="failed"
                  campaignId={campaignId}
                  currentEventNs={
                    computed.campaign_summary.failed?.event_ns ?? null
                  }
                  currentSchoolSlug={
                    computed.campaign_summary.failed?.event_school_slug ?? null
                  }
                  items={palette.mmEvents}
                  emptyMessage="Aucun event MM disponible."
                  onChanged={async () => {
                    await fetchData();
                    setLocalRefsBump((v) => v + 1);
                  }}
                />
              ) : null
            }
          >
            <SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
              {dashboard.steps.length === 0 ? (
                <p className="text-zinc-500 text-sm py-8 text-center">
                  Glissez un event ici pour créer la 1<sup>re</sup> étape.
                </p>
              ) : (
                <ol className="space-y-2">
                  {dashboard.steps.map((s, i) => (
                    <SortableStepGroup
                      key={s.id}
                      step={s}
                      index={i}
                      placeholder={stepDisplayLabel(s)}
                      resolveRef={resolveRef}
                      palette={displayedPalette}
                      onLabelChange={(v) => setStepLabel(i, v)}
                      onAddRef={(p) => addRefToStep(i, p)}
                      onRemoveRef={(refIdx) => removeRefFromStep(i, refIdx)}
                      onRemoveStep={() => removeStep(i)}
                    />
                  ))}
                </ol>
              )}
            </SortableContext>
          </StepsZone>
          )}

          <section className="bg-white border rounded-lg p-3 min-h-[200px] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs uppercase text-zinc-500">
                {dashboard.type === "pie" ? "Pie chart" : "Funnel"}
              </h4>
              <div className="flex items-center gap-2">
                {/* Toggle Barres/Entonnoir réservé au funnel — pie n'a
                    qu'une seule viz (camembert) donc on cache le toggle. */}
                {dashboard.type === "funnel" && (
                  <div className="flex border rounded overflow-hidden text-xs">
                    <button
                      onClick={() => changeView("bar")}
                      className={`px-2 py-1 ${
                        view === "bar"
                          ? "bg-zinc-900 text-white"
                          : "bg-white text-zinc-600 hover:bg-zinc-50"
                      }`}
                      aria-pressed={view === "bar"}
                    >
                      Barres
                    </button>
                    <button
                      onClick={() => changeView("funnel")}
                      className={`px-2 py-1 border-l ${
                        view === "funnel"
                          ? "bg-zinc-900 text-white"
                          : "bg-white text-zinc-600 hover:bg-zinc-50"
                      }`}
                      aria-pressed={view === "funnel"}
                    >
                      Entonnoir
                    </button>
                  </div>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="inline-flex items-center gap-1 border rounded px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                    disabled={
                      exporting ||
                      !computed ||
                      computed.steps.length === 0
                    }
                    aria-label="Télécharger"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {exporting ? "Export…" : "Télécharger"}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={downloadExcel}>
                      Excel (.xlsx) — tableau
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={downloadPDF}>
                      PDF — chart + tableau
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            {dashboard.steps.length === 0 ? (
              <div className="flex items-center justify-center h-40">
                <p className="text-zinc-400 text-sm">
                  Ajoutez au moins{" "}
                  {dashboard.type === "pie" ? "une part" : "une étape"} pour
                  voir la visualisation.
                </p>
              </div>
            ) : computing && !computed ? (
              <p className="text-zinc-500 text-sm">Chargement…</p>
            ) : computeError ? (
              <p className="text-red-600 text-sm">
                Impossible de charger les données.
              </p>
            ) : computed && computed.steps.length > 0 ? (
              <div ref={exportRef} className="space-y-4 bg-white">
                {(computed.from || computed.to) && (
                  <p className="text-xs text-zinc-500">
                    Période : {computed.from} → {computed.to}
                  </p>
                )}
                {dashboard.type === "pie" ? (
                  <>
                    <PieChartViz steps={computed.steps} />
                    <PieTable steps={computed.steps} />
                  </>
                ) : (
                  <>
                    {view === "bar" ? (
                      <FunnelChart steps={computed.steps} />
                    ) : (
                      <FancyFunnelChart steps={computed.steps} />
                    )}
                    <FunnelTable
                      steps={computed.steps}
                      campaignSummary={computed.campaign_summary ?? null}
                    />
                  </>
                )}
              </div>
            ) : (
              <p className="text-zinc-500 text-sm">Chargement…</p>
            )}
          </section>
        </div>
      </div>

      <DragOverlay>
        {activeDrag && (
          <div className="bg-white border rounded shadow px-3 py-2 text-sm">
            {activeDrag.label}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** Encadré ambre au-dessus du builder. 4 stats lecture seule — les
 *  modifications de launch/failed se font désormais via les selects
 *  inline dans la colonne « Étapes du funnel » (CampaignRolesInline),
 *  pour regrouper visuellement toutes les briques de la campagne. */
function CampaignCostSummaryCard({
  summary,
}: {
  summary: CampaignCostSummary;
}) {
  const fmtEur = (n: number) =>
    n.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return (
    <div className="bg-amber-50/40 border border-amber-200 rounded-lg p-4">
      <div className="text-xs uppercase text-amber-800 font-semibold tracking-wide mb-3">
        Synthèse coût Meta de la campagne
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr_1.4fr] gap-4 text-sm">
        <SummaryStat
          label="Envois lancés"
          value={summary.launch.count.toLocaleString("fr-FR")}
          sub={summary.launch.label}
        />
        <SummaryStat
          label="Failed WhatsApp"
          value={
            summary.failed
              ? summary.failed.count.toLocaleString("fr-FR")
              : "—"
          }
          sub={summary.failed?.label ?? "Aucun event failed configuré"}
        />
        <SummaryStat
          label="Envois réussis"
          value={summary.net_count.toLocaleString("fr-FR")}
          sub={
            summary.launch.count > 0
              ? `${((summary.net_count / summary.launch.count) * 100).toFixed(1)} % du lancement`
              : "—"
          }
        />
        {/* Coût NET META — mis en avant : fond ambre plein, typo XL, bouton détail. */}
        <div className="bg-amber-200/60 border border-amber-300 rounded-lg px-4 py-3 flex flex-col justify-center">
          <div className="text-[11px] uppercase tracking-wider text-amber-900 font-bold">
            Coût net Meta
          </div>
          <div className="text-3xl font-bold text-amber-900 leading-tight my-1">
            <MetaCostButton
              amountEur={summary.net_cost_eur}
              breakdown={summary.net_breakdown}
              title="Coût net de la campagne — détail par pays"
            />
          </div>
          <div className="text-[11px] text-amber-800/80 leading-snug">
            {summary.failed
              ? `brut ${fmtEur(summary.launch.cost_eur)} € − ${summary.failed.count.toLocaleString("fr-FR")} failed`
              : "= coût brut (pas de failed)"}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Wrapper ambré pour 1 select de rôle (launch ou failed) placé soit
 *  en topSlot soit en bottomSlot de StepsZone. Le fond ambré subtil
 *  signale qu'il s'agit d'une méta-brique (différent des étapes du
 *  funnel proprement dites). */
function CampaignRoleInline(props: {
  label: string;
  role: "launch" | "failed";
  campaignId: string;
  currentEventNs: string | null;
  currentSchoolSlug: string | null;
  items: PaletteItem[];
  emptyMessage: string;
  onChanged: () => Promise<void> | void;
}) {
  return (
    <div className="bg-amber-50/30 border border-amber-200 rounded p-3 mb-3 last:mb-0 last:mt-3">
      <RoleEventSelect {...props} />
    </div>
  );
}

/** Select inline qui modifie immédiatement (via API) l'event d'un rôle
 *  donné (launch ou failed) sur la campagne. Affiche les events
 *  candidats issus de la palette. Une option « — Aucun — » pour clear le rôle. */
function RoleEventSelect({
  label,
  role,
  campaignId,
  currentEventNs,
  currentSchoolSlug,
  items,
  emptyMessage,
  onChanged,
}: {
  label: string;
  role: "launch" | "failed";
  campaignId: string;
  currentEventNs: string | null;
  currentSchoolSlug: string | null;
  items: PaletteItem[];
  emptyMessage: string;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  // Valeur courante = la palette key correspondant à l'event_ns/school
  // courants. Si non trouvée (event archivé, école retirée), tombe sur "".
  const currentKey = currentEventNs
    ? currentSchoolSlug
      ? `${currentSchoolSlug}:${currentEventNs}`
      : currentEventNs
    : "";

  async function apply(refId: string) {
    setBusy(true);
    try {
      let body: { role: string; event_ns: string | null; event_school_slug?: string | null };
      if (!refId) {
        body = { role, event_ns: null };
      } else {
        // Split palette key en mode multi-école ("<school>:<event_ns>") vs
        // école précise (juste event_ns).
        const item = items.find((p) => p.ref_id === refId);
        if (!item) return;
        const eventNs = item.school_slug
          ? item.ref_id.slice(item.school_slug.length + 1)
          : item.ref_id;
        body = {
          role,
          event_ns: eventNs,
          event_school_slug: item.school_slug ?? null,
        };
      }
      const r = await fetch(`/api/campaigns/${campaignId}/role-event`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await onChanged();
    } catch {
      toast.error("Impossible d'enregistrer le changement");
    } finally {
      setBusy(false);
    }
  }

  const isMultiSchool = items.some((p) => !!p.school_name);
  const groups = new Map<string, PaletteItem[]>();
  if (isMultiSchool) {
    for (const i of items) {
      const k = i.school_name ?? i.school_slug ?? "_";
      const arr = groups.get(k) ?? [];
      arr.push(i);
      groups.set(k, arr);
    }
  }

  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase text-zinc-500 font-semibold tracking-wide">
        {label}
      </span>
      {items.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">{emptyMessage}</p>
      ) : (
        <select
          value={currentKey}
          onChange={(e) => apply(e.target.value)}
          disabled={busy}
          className="w-full text-sm border rounded px-2 py-1.5 bg-white disabled:opacity-60"
        >
          <option value="">— Aucun —</option>
          {isMultiSchool
            ? Array.from(groups.entries()).map(([school, list]) => (
                <optgroup key={school} label={school}>
                  {list.map((i) => (
                    <option key={i.ref_id} value={i.ref_id}>
                      {i.label}
                    </option>
                  ))}
                </optgroup>
              ))
            : items.map((i) => (
                <option key={i.ref_id} value={i.ref_id}>
                  {i.label}
                </option>
              ))}
        </select>
      )}
    </label>
  );
}

function SummaryStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase text-zinc-500 font-semibold tracking-wide">
        {label}
      </div>
      <div className="text-lg font-semibold text-zinc-900">{value}</div>
      {sub && (
        <div
          className="text-[11px] text-zinc-500 truncate"
          title={sub}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function PaletteRow({ item }: { item: PaletteItem }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${PALETTE_PREFIX}${item.ref_id}`,
  });
  // Tooltip natif : la palette tronque à 240 px, beaucoup de noms d'events
  // font 30-60 chars. Le `title` permet de lire le label complet au hover
  // sans avoir à élargir la sidebar.
  const fullLabel = item.school_name
    ? `[${item.school_name}] ${item.label}`
    : item.label;
  return (
    <li
      ref={setNodeRef}
      className={`flex items-start gap-2 px-2 py-1 hover:bg-zinc-50 rounded text-sm cursor-grab ${
        isDragging ? "opacity-30" : ""
      }`}
      title={fullLabel}
      {...attributes}
      {...listeners}
    >
      {item.school_name && (
        <span className="text-[10px] font-mono px-1 py-0 rounded bg-amber-100 text-amber-800 shrink-0 mt-0.5">
          {item.school_name}
        </span>
      )}
      {/* On laisse le label wrapper sur plusieurs lignes plutôt que tronquer :
          la sidebar est à 340 px, la majorité des labels tiennent sur 1-2 lignes
          et l'utilisateur lit tout d'un coup d'œil sans dépendre du tooltip. */}
      <span className="flex-1 leading-snug break-words">{item.label}</span>
    </li>
  );
}

function StepsZone({
  hasSteps,
  title,
  onCollapse,
  topSlot,
  bottomSlot,
  children,
}: {
  hasSteps: boolean;
  title: string;
  onCollapse?: () => void;
  /** Bloc optionnel rendu entre le titre et la liste des étapes.
   *  Mode campagne : select Event de lancement (en haut, avant le funnel). */
  topSlot?: React.ReactNode;
  /** Bloc optionnel rendu SOUS la liste des étapes.
   *  Mode campagne : select Event failed WhatsApp (en bas, après le funnel).
   *  Cohérent avec le flow logique lancement → étapes → failed. */
  bottomSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: STEPS_ZONE_ID });
  return (
    <section
      ref={setNodeRef}
      className={`bg-white border rounded-lg p-3 space-y-2 min-h-[200px] transition-colors relative ${
        isOver && !hasSteps ? "bg-zinc-50 border-zinc-400" : ""
      }`}
    >
      {onCollapse && (
        <button
          onClick={onCollapse}
          className="absolute top-2 right-2 text-zinc-400 hover:text-zinc-900 p-0.5"
          title="Réduire les étapes"
          aria-label="Réduire les étapes"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      <h4 className="text-xs uppercase text-zinc-500 mb-2">{title}</h4>
      {topSlot}
      {children}
      {bottomSlot}
    </section>
  );
}

/** Bande étroite (44px) qui remplace une colonne du builder quand elle
 *  est rétractée. Affiche un bouton d'expand en haut + le titre en mode
 *  écrit vertical pour qu'on sache à quoi sert le panneau caché. */
function CollapsedPane({
  label,
  onExpand,
}: {
  label: string;
  onExpand: () => void;
}) {
  return (
    <aside className="bg-white border rounded-lg p-2 flex flex-col items-center gap-3 min-h-[200px]">
      <button
        onClick={onExpand}
        className="text-zinc-400 hover:text-zinc-900 p-0.5"
        title={`Déplier « ${label} »`}
        aria-label={`Déplier ${label}`}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <span
        className="text-[10px] uppercase text-zinc-500 font-semibold tracking-wide select-none"
        style={{ writingMode: "vertical-rl" }}
      >
        {label}
      </span>
    </aside>
  );
}

interface SortableStepGroupProps {
  step: DashboardStep;
  index: number;
  placeholder: string;
  resolveRef: (r: StepRef) => {
    label: string;
    available: boolean;
    schoolName: string | null;
  };
  palette: Palette;
  onLabelChange: (v: string) => void;
  onAddRef: (p: PaletteItem) => void;
  onRemoveRef: (refIdx: number) => void;
  onRemoveStep: () => void;
}

function SortableStepGroup({
  step,
  index,
  placeholder,
  resolveRef,
  palette,
  onLabelChange,
  onAddRef,
  onRemoveRef,
  onRemoveStep,
}: SortableStepGroupProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: step.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // Mixed type detection
  const types = new Set(step.refs.map((r) => r.step_type));
  const typeBadge =
    types.size > 1 ? "Mixte" : types.has("mm_event") ? "MM" : types.has("url_click") ? "URL" : "—";

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`bg-zinc-50 rounded border p-2 transition-colors ${
        isOver ? "border-zinc-500 bg-zinc-100" : ""
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-zinc-400 hover:text-zinc-700 -ml-1 p-1"
          aria-label="Réordonner"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="text-xs text-zinc-400 w-5">{index + 1}.</span>
        <Input
          value={step.label ?? ""}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 h-8 text-sm bg-white"
        />
        <span className="text-xs text-zinc-400 w-12 text-right">{typeBadge}</span>
        <button
          onClick={onRemoveStep}
          className="text-zinc-400 hover:text-red-600 p-1"
          aria-label="Supprimer l'étape"
          title="Supprimer l'étape entière"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 pl-7">
        {step.refs.map((r, ri) => {
          const meta = resolveRef(r);
          return (
            <span
              key={r.id}
              className={`inline-flex items-center gap-1 bg-white border rounded px-2 py-0.5 text-xs ${
                meta.available ? "" : "opacity-60"
              }`}
              title={
                meta.available
                  ? meta.schoolName
                    ? `[${meta.schoolName}] ${meta.label}`
                    : meta.label
                  : `${meta.label} (cette source n'existe plus)`
              }
            >
              {meta.schoolName && (
                <span className="text-[10px] font-mono px-1 py-0 rounded bg-amber-100 text-amber-800">
                  {meta.schoolName}
                </span>
              )}
              <span className="truncate max-w-[160px]">{meta.label}</span>
              {!meta.available && (
                <span className="text-amber-700 bg-amber-100 px-1 rounded">!</span>
              )}
              <button
                onClick={() => onRemoveRef(ri)}
                className="text-zinc-400 hover:text-red-600"
                aria-label="Retirer cette source"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        })}
        <AddRefMenu palette={palette} onAdd={onAddRef} />
      </div>
    </li>
  );
}

function AddRefMenu({
  palette,
  onAdd,
}: {
  palette: Palette;
  onAdd: (p: PaletteItem) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1 border border-dashed rounded px-2 py-0.5 text-xs text-zinc-500 hover:text-zinc-900 hover:border-zinc-400"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Plus className="h-3 w-3" /> Ajouter
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-auto w-64">
        {palette.mmEvents.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs uppercase text-zinc-500">
              Custom events MM
            </DropdownMenuLabel>
            {palette.mmEvents.map((p) => (
              <DropdownMenuItem
                key={p.ref_id}
                onClick={() => onAdd(p)}
                className="text-sm flex items-center gap-2"
                title={
                  p.school_name ? `[${p.school_name}] ${p.label}` : p.label
                }
              >
                {p.school_name && (
                  <span className="text-[10px] font-mono px-1 py-0 rounded bg-amber-100 text-amber-800 shrink-0">
                    {p.school_name}
                  </span>
                )}
                <span className="truncate">{p.label}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
        {palette.mmEvents.length > 0 && palette.redirectEvents.length > 0 && (
          <DropdownMenuSeparator />
        )}
        {palette.redirectEvents.length > 0 && (
          <>
            <DropdownMenuLabel className="text-xs uppercase text-zinc-500">
              Clics URL
            </DropdownMenuLabel>
            {palette.redirectEvents.map((p) => (
              <DropdownMenuItem
                key={p.ref_id}
                onClick={() => onAdd(p)}
                className="text-sm flex items-center gap-2"
                title={
                  p.school_name ? `[${p.school_name}] ${p.label}` : p.label
                }
              >
                {p.school_name && (
                  <span className="text-[10px] font-mono px-1 py-0 rounded bg-amber-100 text-amber-800 shrink-0">
                    {p.school_name}
                  </span>
                )}
                <span className="truncate">{p.label}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
        {palette.mmEvents.length === 0 &&
          palette.redirectEvents.length === 0 && (
            <DropdownMenuItem disabled className="text-xs text-zinc-500">
              Aucun event disponible
            </DropdownMenuItem>
          )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
