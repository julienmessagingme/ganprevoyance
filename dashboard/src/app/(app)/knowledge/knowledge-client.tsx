"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface KbSource {
  url: string;
  title: string | null;
  kind: string | null;
  chunks: number;
  sourceType: "site" | "document" | "manuel" | "autre";
  preview: string;
  updated: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  site: "Site web",
  document: "Document",
  manuel: "Manuel",
  autre: "Autre",
};
const TYPE_CLASS: Record<string, string> = {
  site: "bg-blue-100 text-blue-700",
  document: "bg-amber-100 text-amber-700",
  manuel: "bg-emerald-100 text-emerald-700",
  autre: "bg-zinc-100 text-zinc-700",
};

export function KnowledgeClient({ schoolName }: { schoolName: string }) {
  const [sources, setSources] = useState<KbSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog d'édition / création.
  const [open, setOpen] = useState(false);
  const [editUrl, setEditUrl] = useState<string | null>(null); // null = création
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/knowledge/kb");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setSources(j.sources ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditUrl(null);
    setTitle("");
    setContent("");
    setOpen(true);
  }

  async function openEdit(url: string) {
    setEditUrl(url);
    setTitle("");
    setContent("");
    setOpen(true);
    setBusy(true);
    try {
      const r = await fetch(`/api/knowledge/kb?url=${encodeURIComponent(url)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setTitle(j.source?.title ?? "");
      setContent(j.source?.content ?? "");
    } catch (e) {
      toast.error("Chargement impossible : " + (e instanceof Error ? e.message : String(e)));
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!content.trim()) {
      toast.error("Le contenu est vide.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/knowledge/kb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: editUrl ?? undefined, title: title.trim() || undefined, content }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      toast.success(editUrl ? "Entrée mise à jour" : "Entrée ajoutée à la base du bot");
      setOpen(false);
      await load();
    } catch (e) {
      toast.error("Échec : " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  async function remove(url: string, label: string) {
    if (!confirm(`Supprimer définitivement "${label}" de la base de connaissance du bot ?`)) return;
    try {
      const r = await fetch(`/api/knowledge/kb?url=${encodeURIComponent(url)}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      toast.success("Entrée supprimée");
      await load();
    } catch (e) {
      toast.error("Échec : " + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold">Base de connaissance</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            Rafraîchir
          </Button>
          <Button onClick={openCreate}>+ Ajouter</Button>
        </div>
      </div>
      <p className="text-sm text-zinc-500 mb-5">
        Contenu utilisé par le bot WhatsApp de {schoolName} pour répondre (site, documents,
        entrées manuelles). Tout ce qui est ici alimente directement les réponses du bot.
      </p>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 text-red-700 text-sm p-3">
          Erreur : {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-zinc-500">Chargement…</div>
      ) : sources.length === 0 ? (
        <div className="text-sm text-zinc-500">
          Base vide. Ajoutez une entrée, ou lancez le scraping / l’import de documents côté bot.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Titre</th>
                <th className="px-3 py-2 font-medium">Aperçu</th>
                <th className="px-3 py-2 font-medium text-right">Extraits</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sources.map((s) => (
                <tr key={s.url} className="align-top hover:bg-zinc-50">
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                        TYPE_CLASS[s.sourceType] ?? TYPE_CLASS.autre
                      }`}
                    >
                      {TYPE_LABEL[s.sourceType] ?? "Autre"}
                    </span>
                  </td>
                  <td className="px-3 py-2 max-w-[220px]">
                    <div className="font-medium truncate">{s.title || "(sans titre)"}</div>
                    {s.sourceType === "site" && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 hover:underline break-all"
                      >
                        {s.url}
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-600 max-w-[320px]">
                    <div className="line-clamp-2">{s.preview}</div>
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-500">{s.chunks}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button variant="outline" size="sm" onClick={() => openEdit(s.url)}>
                      Voir / éditer
                    </Button>{" "}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => remove(s.url, s.title || s.url)}
                    >
                      Supprimer
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editUrl ? "Éditer l’entrée" : "Ajouter à la base de connaissance"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="kb-title">Titre</Label>
              <Input
                id="kb-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex. Délais de remboursement"
                disabled={busy}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="kb-content">Contenu</Label>
              <textarea
                id="kb-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={busy}
                rows={14}
                className="w-full rounded-md border px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-zinc-300"
                placeholder={"Pour une question/réponse :\n\nQuestion : ...\nRéponse : ..."}
              />
              <p className="text-xs text-zinc-400">
                Le contenu est découpé et indexé automatiquement pour le bot.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Annuler
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
