"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function UploadTextTab({ onUploaded }: { onUploaded: () => void }) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const r = await fetch("/api/knowledge/upload-text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, title: title.trim() || undefined }),
    });
    setSubmitting(false);
    if (r.ok) {
      toast.success("Texte ajouté à la base");
      setText("");
      setTitle("");
      onUploaded();
    } else {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      toast.error(j.error ?? "Erreur");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="text-title">Titre du document (optionnel)</Label>
        <Input
          id="text-title"
          placeholder="Ex: Règlement intérieur 2026"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="text-content">Contenu</Label>
        <textarea
          id="text-content"
          rows={12}
          required
          minLength={1}
          maxLength={200_000}
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 resize-vertical"
          placeholder="Saisissez le texte à ajouter à la base de connaissance. Il sera converti en PDF avant d'être indexé."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="text-xs text-zinc-500">
          Conversion automatique en PDF avant indexation OpenAI.
        </p>
      </div>
      <Button type="submit" disabled={submitting || text.trim().length === 0}>
        {submitting ? "Ajout…" : "Ajouter à la base"}
      </Button>
    </form>
  );
}
