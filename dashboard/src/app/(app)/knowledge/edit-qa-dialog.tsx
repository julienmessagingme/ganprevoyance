"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { KnowledgeItem, Theme, Subtheme } from "./types";

const NONE_VALUE = "__none__";

export function EditQaDialog({
  item,
  onOpenChange,
  onSaved,
}: {
  item: KnowledgeItem | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [themes, setThemes] = useState<Theme[]>([]);
  const [subthemes, setSubthemes] = useState<Subtheme[]>([]);
  const [themeId, setThemeId] = useState<string | null>(null);
  const [subthemeId, setSubthemeId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!item) return;
    setQuestion(item.question ?? "");
    setAnswer(item.answer ?? "");
    setThemeId(item.theme_id);
    setSubthemeId(item.subtheme_id);
    fetch("/api/knowledge/themes")
      .then((r) => r.json())
      .then((j) => setThemes(j.themes ?? []));
    const url = item.theme_id
      ? `/api/knowledge/subthemes?themeId=${item.theme_id}`
      : "/api/knowledge/subthemes";
    fetch(url)
      .then((r) => r.json())
      .then((j) => setSubthemes(j.subthemes ?? []));
  }, [item]);

  // When theme changes during edit, reload subthemes filtered to it.
  useEffect(() => {
    if (!item) return;
    const url = themeId
      ? `/api/knowledge/subthemes?themeId=${themeId}`
      : "/api/knowledge/subthemes";
    fetch(url)
      .then((r) => r.json())
      .then((j) => setSubthemes(j.subthemes ?? []));
    // Don't reset subthemeId — user might be intentionally keeping a
    // standalone subtheme even after picking a theme.
  }, [themeId, item]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!item) return;
    setSubmitting(true);
    const r = await fetch(`/api/knowledge/items/${item.id}`, {
      method: "PATCH",
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
      toast.success("Q&R mise à jour");
      onSaved();
    } else {
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      toast.error(j.message ?? j.error ?? "Erreur");
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Modifier la Q&R</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-zinc-500 -mt-2">
          Le fichier OpenAI est remplacé : ancien supprimé, nouveau créé.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Thème</Label>
              <Select
                value={themeId ?? NONE_VALUE}
                onValueChange={(v) => setThemeId(v === NONE_VALUE ? null : v)}
              >
                <SelectTrigger>
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
            </div>
            <div className="space-y-2">
              <Label>Sous-thème</Label>
              <Select
                value={subthemeId ?? NONE_VALUE}
                onValueChange={(v) => setSubthemeId(v === NONE_VALUE ? null : v)}
              >
                <SelectTrigger>
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
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-q">Question</Label>
            <textarea
              id="edit-q"
              rows={3}
              required
              maxLength={2000}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 resize-vertical"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-a">Réponse</Label>
            <textarea
              id="edit-a"
              rows={6}
              required
              maxLength={20000}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 resize-vertical"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
