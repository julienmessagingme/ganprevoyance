"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import type { Theme, Subtheme } from "./types";

const NONE_VALUE = "__none__";

export function UploadQaTab({
  onUploaded,
}: {
  schoolSlug: string;
  onUploaded: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [themes, setThemes] = useState<Theme[]>([]);
  const [subthemes, setSubthemes] = useState<Subtheme[]>([]);
  const [themeId, setThemeId] = useState<string | null>(null);
  const [subthemeId, setSubthemeId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadThemes() {
    const r = await fetch("/api/knowledge/themes").then((res) => res.json());
    setThemes(r.themes ?? []);
  }
  async function loadSubthemes(forThemeId: string | null) {
    const url = forThemeId
      ? `/api/knowledge/subthemes?themeId=${forThemeId}`
      : "/api/knowledge/subthemes";
    const r = await fetch(url).then((res) => res.json());
    setSubthemes(r.subthemes ?? []);
  }

  useEffect(() => {
    loadThemes();
    loadSubthemes(null);
  }, []);

  useEffect(() => {
    setSubthemeId(null);
    loadSubthemes(themeId);
  }, [themeId]);

  async function quickCreate(kind: "theme" | "subtheme") {
    const label = kind === "theme" ? "Nom du thème" : "Nom du sous-thème";
    const name = prompt(label);
    if (!name?.trim()) return;
    const url =
      kind === "theme"
        ? "/api/knowledge/themes"
        : "/api/knowledge/subthemes";
    const body =
      kind === "theme"
        ? { name }
        : { name, themeId: themeId ?? null };
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { message?: string };
      toast.error(j.message ?? "Erreur");
      return;
    }
    const j = await r.json();
    toast.success(kind === "theme" ? "Thème créé" : "Sous-thème créé");
    if (kind === "theme") {
      await loadThemes();
      setThemeId(j.theme.id);
    } else {
      await loadSubthemes(themeId);
      setSubthemeId(j.subtheme.id);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const r = await fetch("/api/knowledge/upload-qa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question,
        answer,
        themeId: themeId ?? null,
        subthemeId: subthemeId ?? null,
      }),
    });
    setSubmitting(false);
    if (r.ok) {
      toast.success("Q&R ajoutée");
      setQuestion("");
      setAnswer("");
      setSubthemeId(null);
      // theme is intentionally kept selected for batch input.
      onUploaded();
    } else {
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        field?: string;
      };
      toast.error(j.message ?? j.error ?? "Erreur");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Thème (optionnel)</Label>
          <div className="flex gap-2">
            <Select
              value={themeId ?? NONE_VALUE}
              onValueChange={(v) => setThemeId(v === NONE_VALUE ? null : v)}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Aucun">
                  {(v: string | null) =>
                    v == null || v === NONE_VALUE
                      ? "— Aucun —"
                      : (themes.find((t) => t.id === v)?.name ?? v)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>— Aucun —</SelectItem>
                {themes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => quickCreate("theme")}
              aria-label="Nouveau thème"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Sous-thème (optionnel)</Label>
          <div className="flex gap-2">
            <Select
              value={subthemeId ?? NONE_VALUE}
              onValueChange={(v) => setSubthemeId(v === NONE_VALUE ? null : v)}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Aucun">
                  {(v: string | null) =>
                    v == null || v === NONE_VALUE
                      ? "— Aucun —"
                      : (subthemes.find((s) => s.id === v)?.name ?? v)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>— Aucun —</SelectItem>
                {subthemes.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => quickCreate("subtheme")}
              aria-label="Nouveau sous-thème"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="qa-q">Question</Label>
        <textarea
          id="qa-q"
          rows={3}
          required
          maxLength={2000}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 resize-vertical"
          placeholder="Quels sont les tarifs de la formation ?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="qa-a">Réponse</Label>
        <textarea
          id="qa-a"
          rows={6}
          required
          maxLength={20000}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 resize-vertical"
          placeholder="La formation coûte 9000€/an, payable en 3 mensualités…"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
      </div>

      <Button
        type="submit"
        disabled={submitting || !question.trim() || !answer.trim()}
      >
        {submitting ? "Ajout…" : "Ajouter la Q&R"}
      </Button>
    </form>
  );
}
