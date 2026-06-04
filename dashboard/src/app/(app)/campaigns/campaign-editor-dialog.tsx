"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { Palette, PaletteItem } from "@/lib/dashboards/types";
import type {
  CampaignRef,
  CampaignWithRefs,
  CampaignRefRole,
} from "@/lib/campaigns/types";
import { paletteKeyOf } from "@/lib/campaigns/utils";

interface Props {
  mode: "new" | "edit";
  campaignId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Appelé après une création réussie (mode="new"), avec l'id de la
   *  nouvelle campagne. */
  onCreated?: (id: string) => void;
}

/**
 * Dialog 3-sections (Phase 25+) :
 *   1) Event de lancement (optionnel, 1 seul) — events porteurs de tel
 *      uniquement. Sert au calcul du coût Meta.
 *   2) Briques du funnel (events + URLs) — drag-and-drop dans le builder.
 *   3) Event failed WhatsApp (optionnel, 1 seul) — soustrait du launch.
 *
 * Un même event ne peut être assigné qu'à UN seul rôle : on exclut donc
 * les keys déjà utilisées ailleurs dans les choix proposés.
 */
export function CampaignEditorDialog({
  mode,
  campaignId,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [isShared, setIsShared] = useState(false);
  const [palette, setPalette] = useState<Palette | null>(null);

  /** paletteKey de l'event launch, ou null. */
  const [launchKey, setLaunchKey] = useState<string | null>(null);
  /** Set de paletteKeys des briques body. */
  const [bodyKeys, setBodyKeys] = useState<Set<string>>(new Set());
  /** paletteKey de l'event failed, ou null. */
  const [failedKey, setFailedKey] = useState<string | null>(null);

  const [bodySearch, setBodySearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Charge palette + (si edit) campaign + dispatch refs selon role.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const pRes = await fetch("/api/dashboards/palette");
        if (!pRes.ok) throw new Error("palette");
        const pJson = (await pRes.json()) as Palette;
        if (!alive) return;
        setPalette(pJson);

        if (mode === "edit" && campaignId) {
          const cRes = await fetch(`/api/campaigns/${campaignId}`);
          if (!cRes.ok) throw new Error("campaign");
          const { campaign } = (await cRes.json()) as {
            campaign: CampaignWithRefs;
          };
          if (!alive) return;
          setName(campaign.name);
          setIsShared(campaign.is_shared);

          // Dispatch des refs par rôle. paletteKeyOf retombe sur le bon
          // composite key qu'on utilise côté palette.
          let l: string | null = null;
          let f: string | null = null;
          const b = new Set<string>();
          for (const r of campaign.refs as CampaignRef[]) {
            const key = paletteKeyOf(r);
            if (r.role === "launch") l = key;
            else if (r.role === "failed") f = key;
            else b.add(key);
          }
          setLaunchKey(l);
          setBodyKeys(b);
          setFailedKey(f);
        } else {
          setName("");
          setIsShared(false);
          setLaunchKey(null);
          setBodyKeys(new Set());
          setFailedKey(null);
        }
      } catch {
        toast.error("Erreur de chargement");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mode, campaignId]);

  // --- Sélections dérivées (filtrage par rôle) ---

  /** Index palette par ref_id pour reconstruire les items au save. */
  const itemByKey = useMemo(() => {
    if (!palette) return new Map<string, PaletteItem>();
    return new Map(
      [...palette.mmEvents, ...palette.redirectEvents].map((i) => [i.ref_id, i])
    );
  }, [palette]);

  // Section 1 (launch) : events MM porteurs uniquement, hors body / failed.
  const launchCandidates = useMemo(() => {
    if (!palette) return [];
    return palette.mmEvents.filter(
      (i) =>
        i.has_text_value === true &&
        i.ref_id !== failedKey &&
        !bodyKeys.has(i.ref_id)
    );
  }, [palette, failedKey, bodyKeys]);

  // Section 3 (failed) : tous les events MM, hors body / launch.
  const failedCandidates = useMemo(() => {
    if (!palette) return [];
    return palette.mmEvents.filter(
      (i) => i.ref_id !== launchKey && !bodyKeys.has(i.ref_id)
    );
  }, [palette, launchKey, bodyKeys]);

  // Section 2 (body) : events MM + URLs, hors launch / failed.
  const bodyMm = useMemo(() => {
    if (!palette) return [];
    return palette.mmEvents.filter(
      (i) => i.ref_id !== launchKey && i.ref_id !== failedKey
    );
  }, [palette, launchKey, failedKey]);
  const bodyUrls = useMemo(() => {
    if (!palette) return [];
    return palette.redirectEvents;
  }, [palette]);

  function filterBySearch(list: PaletteItem[]): PaletteItem[] {
    const q = bodySearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        (i.school_name ?? "").toLowerCase().includes(q)
    );
  }
  const filteredBodyMm = useMemo(
    () => filterBySearch(bodyMm),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bodyMm, bodySearch]
  );
  const filteredBodyUrls = useMemo(
    () => filterBySearch(bodyUrls),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bodyUrls, bodySearch]
  );

  function toggleBody(item: PaletteItem) {
    setBodyKeys((prev) => {
      const next = new Set(prev);
      if (next.has(item.ref_id)) next.delete(item.ref_id);
      else next.add(item.ref_id);
      return next;
    });
  }

  // --- Save ---

  function makeRefPayload(key: string, role: CampaignRefRole) {
    const item = itemByKey.get(key);
    if (!item) return null;
    if (item.step_type === "mm_event") {
      const eventNs = item.school_slug
        ? item.ref_id.slice(item.school_slug.length + 1)
        : item.ref_id;
      return {
        step_type: "mm_event" as const,
        event_ns: eventNs,
        ...(item.school_slug ? { event_school_slug: item.school_slug } : {}),
        role,
      };
    }
    return {
      step_type: "url_click" as const,
      redirect_event_id: item.ref_id,
      role: "body" as const, // url_click ne peut être que body (cf. API zod)
    };
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const refs = [
        ...(launchKey ? [makeRefPayload(launchKey, "launch")] : []),
        ...Array.from(bodyKeys).map((k) => makeRefPayload(k, "body")),
        ...(failedKey ? [makeRefPayload(failedKey, "failed")] : []),
      ].filter(Boolean);

      const body = JSON.stringify({
        name: trimmed,
        is_shared: isShared,
        refs,
      });

      if (mode === "new") {
        const r = await fetch("/api/campaigns", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const { id } = (await r.json()) as { id: string };
        toast.success("Campagne créée");
        onCreated?.(id);
      } else if (campaignId) {
        const r = await fetch(`/api/campaigns/${campaignId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body,
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        toast.success("Enregistré");
      }
      onOpenChange(false);
    } catch {
      toast.error("Erreur d'enregistrement");
    } finally {
      setSaving(false);
    }
  }

  // --- Render ---

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col sm:!max-w-4xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {mode === "new" ? "Nouvelle campagne" : "Éditer la campagne"}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-zinc-500 text-sm py-8">Chargement…</p>
        ) : !palette ? (
          <p className="text-red-600 text-sm py-8">Erreur de chargement</p>
        ) : (
          <div className="flex flex-col flex-1 min-h-0 space-y-4 overflow-y-auto pr-1">
            {/* Bloc méta : nom + partagée */}
            <div className="space-y-2 shrink-0">
              <Label htmlFor="campaign-name">Nom</Label>
              <Input
                id="campaign-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Campagne JPO portes ouvertes mai 2026"
                autoFocus
              />
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <input
                id="campaign-shared"
                type="checkbox"
                checked={isShared}
                onChange={(e) => setIsShared(e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="campaign-shared" className="cursor-pointer">
                Partagée avec l&apos;école
              </Label>
              <span className="text-xs text-zinc-500">
                {isShared ? "Visible par tous" : "Visible uniquement par vous"}
              </span>
            </div>

            {/* Section 1 : Event de lancement */}
            <SectionCard
              step={1}
              title="Event de lancement"
              hint="Optionnel. Event qui porte le numéro de tel des destinataires (text_label défini dans Smartlink). Sert au calcul du coût Meta."
            >
              <EventSelect
                value={launchKey}
                onChange={setLaunchKey}
                items={launchCandidates}
                placeholder="— Aucun event de lancement —"
                emptyMessage="Aucun event porteur de tel disponible. Configurez `text_label` sur un event Smartlink."
              />
            </SectionCard>

            {/* Section 2 : Briques du funnel */}
            <SectionCard
              step={2}
              title={`Briques du funnel (${bodyKeys.size} sélectionnée${
                bodyKeys.size > 1 ? "s" : ""
              })`}
              hint="Events MM et URLs trackées qu'on pourra glisser-déposer en étapes dans le builder."
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-zinc-500">
                  Multi-sélection. L&apos;event de lancement et le failed sont exclus.
                </span>
                <Input
                  value={bodySearch}
                  onChange={(e) => setBodySearch(e.target.value)}
                  placeholder="Rechercher…"
                  className="w-48 h-8 text-sm"
                />
              </div>
              <div className="border rounded flex h-[400px]">
                <RefList
                  title={`Custom events MM (${filteredBodyMm.length})`}
                  items={filteredBodyMm}
                  selectedKeys={bodyKeys}
                  onToggle={toggleBody}
                  searchActive={bodySearch.trim().length > 0}
                  className="flex-1 border-r"
                />
                <RefList
                  title={`Clics URL (${filteredBodyUrls.length})`}
                  items={filteredBodyUrls}
                  selectedKeys={bodyKeys}
                  onToggle={toggleBody}
                  searchActive={bodySearch.trim().length > 0}
                  className="flex-1"
                />
              </div>
            </SectionCard>

            {/* Section 3 : Event failed WhatsApp */}
            <SectionCard
              step={3}
              title="Event failed WhatsApp"
              hint="Optionnel. Count soustrait du lancement pour calculer les envois réussis et ajuster le coût Meta."
            >
              <EventSelect
                value={failedKey}
                onChange={setFailedKey}
                items={failedCandidates}
                placeholder="— Aucun event failed —"
                emptyMessage="Aucun event MM disponible."
              />
            </SectionCard>
          </div>
        )}

        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Annuler
          </Button>
          <Button
            onClick={save}
            disabled={saving || loading || !name.trim() || !palette}
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Carte numérotée pour une section de la dialog. */
function SectionCard({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border rounded-lg p-3 space-y-2 shrink-0 bg-white">
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-white">
          {step}
        </span>
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      <div>{children}</div>
    </section>
  );
}

/** Select natif avec optgroup par école en mode multi-école. Accepte une
 *  option vide « Aucun » pour les rôles optionnels (launch / failed). */
function EventSelect({
  value,
  onChange,
  items,
  placeholder,
  emptyMessage,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  items: PaletteItem[];
  placeholder: string;
  emptyMessage: string;
}) {
  const isMultiSchool = items.some((i) => !!i.school_name);
  const groups = new Map<string, PaletteItem[]>();
  if (isMultiSchool) {
    for (const i of items) {
      const k = i.school_name ?? i.school_slug ?? "_";
      const arr = groups.get(k) ?? [];
      arr.push(i);
      groups.set(k, arr);
    }
  }
  if (items.length === 0) {
    return (
      <p className="text-xs text-zinc-400 italic">{emptyMessage}</p>
    );
  }
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="w-full text-sm border rounded px-2 py-1.5 bg-white"
    >
      <option value="">{placeholder}</option>
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
  );
}

function RefList({
  title,
  items,
  selectedKeys,
  onToggle,
  searchActive,
  className = "",
}: {
  title: string;
  items: PaletteItem[];
  selectedKeys: Set<string>;
  onToggle: (p: PaletteItem) => void;
  searchActive: boolean;
  className?: string;
}) {
  const isMultiSchool = items.some((p) => !!p.school_name);
  const groups = new Map<
    string,
    { name: string; items: PaletteItem[] }
  >();
  if (isMultiSchool) {
    for (const p of items) {
      const key = p.school_slug ?? "_";
      const display = p.school_name ?? key;
      const g = groups.get(key);
      if (g) g.items.push(p);
      else groups.set(key, { name: display, items: [p] });
    }
  }

  return (
    <div className={`overflow-auto ${className}`}>
      <h4 className="text-xs uppercase text-zinc-500 px-3 pt-3 pb-1 sticky top-0 bg-white border-b z-10">
        {title}
      </h4>
      {items.length === 0 ? (
        <p className="px-3 py-2 text-xs text-zinc-400">Aucun</p>
      ) : isMultiSchool ? (
        <div>
          {Array.from(groups.values()).map((g) => {
            const groupChecked = g.items.filter((p) =>
              selectedKeys.has(p.ref_id)
            ).length;
            return (
              <details
                key={g.name}
                open={searchActive || groupChecked > 0}
                className="border-b last:border-b-0"
              >
                <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-semibold hover:bg-zinc-50 flex items-center gap-2">
                  <span className="text-[10px] font-mono px-1 py-0 rounded bg-amber-100 text-amber-800">
                    {g.name}
                  </span>
                  <span className="text-zinc-600">{g.items.length}</span>
                  {groupChecked > 0 && (
                    <span className="text-zinc-400 ml-auto text-[10px]">
                      {groupChecked} coché{groupChecked > 1 ? "s" : ""}
                    </span>
                  )}
                </summary>
                <ul className="pb-1">
                  {g.items.map((p) => (
                    <RefRow
                      key={p.ref_id}
                      item={p}
                      checked={selectedKeys.has(p.ref_id)}
                      onToggle={onToggle}
                      hideSchoolChip
                    />
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      ) : (
        <ul>
          {items.map((p) => (
            <RefRow
              key={p.ref_id}
              item={p}
              checked={selectedKeys.has(p.ref_id)}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RefRow({
  item,
  checked,
  onToggle,
  hideSchoolChip = false,
}: {
  item: PaletteItem;
  checked: boolean;
  onToggle: (p: PaletteItem) => void;
  hideSchoolChip?: boolean;
}) {
  return (
    <li>
      <label
        className="flex items-start gap-2 px-3 py-1.5 hover:bg-zinc-50 cursor-pointer text-sm"
        title={
          item.school_name ? `[${item.school_name}] ${item.label}` : item.label
        }
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(item)}
          className="shrink-0 mt-0.5"
        />
        {!hideSchoolChip && item.school_name && (
          <span className="text-[10px] font-mono px-1 py-0 rounded bg-amber-100 text-amber-800 shrink-0 mt-0.5">
            {item.school_name}
          </span>
        )}
        <span className="flex-1 break-words leading-snug">{item.label}</span>
      </label>
    </li>
  );
}
