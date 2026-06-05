"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import type { DashboardType } from "@/lib/dashboards/types";

export function NewDashboardDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<DashboardType>("funnel");
  const [isShared, setIsShared] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const r = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, type, is_shared: isShared }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { id } = (await r.json()) as { id: string };
      onOpenChange(false);
      setName("");
      setType("funnel");
      setIsShared(false);
      router.push(`/dashboards/${id}`);
    } catch {
      toast.error("Erreur de création");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau tableau</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nom du tableau</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="JPO portes ouvertes"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !submitting) submit();
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>Type de visualisation</Label>
            <DashboardTypeRadio value={type} onChange={setType} />
          </div>

          <div className="flex items-center gap-3">
            <input
              id="dashboard-shared"
              type="checkbox"
              checked={isShared}
              onChange={(e) => setIsShared(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="dashboard-shared" className="cursor-pointer">
              Partagé avec le domaine
            </Label>
            <span className="text-xs text-zinc-500">
              {isShared
                ? "Visible par tous les utilisateurs du domaine"
                : "Visible uniquement par vous"}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Annuler
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? "Création…" : "Créer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Radio compact funnel / pie partagé entre NewDashboardDialog et
 *  CampaignEditorDialog. Exposé en composant pour rester DRY ; chaque
 *  carte décrit ce que fait le type pour aider l'utilisateur à choisir. */
export function DashboardTypeRadio({
  value,
  onChange,
}: {
  value: DashboardType;
  onChange: (v: DashboardType) => void;
}) {
  const options: { value: DashboardType; label: string; hint: string }[] = [
    {
      value: "funnel",
      label: "Funnel",
      hint: "Étapes ordonnées · conversions étape à étape",
    },
    {
      value: "pie",
      label: "Pie chart",
      hint: "Parts du gâteau · répartition base 100",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`text-left border rounded p-3 transition-colors ${
              selected
                ? "border-zinc-900 bg-zinc-50"
                : "border-zinc-200 hover:border-zinc-400"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-3 w-3 rounded-full border-2 ${
                  selected
                    ? "border-zinc-900 bg-zinc-900"
                    : "border-zinc-400"
                }`}
              />
              <span className="font-medium text-sm">{o.label}</span>
            </div>
            <p className="text-xs text-zinc-500 mt-1.5">{o.hint}</p>
          </button>
        );
      })}
    </div>
  );
}
