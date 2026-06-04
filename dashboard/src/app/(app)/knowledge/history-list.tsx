"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { FileText, MessageSquareText, FileType, Pencil, Trash2, Search, Loader2 } from "lucide-react";
import type { KnowledgeItem } from "./types";
import { EditQaDialog } from "./edit-qa-dialog";

const TYPE_FILTERS = [
  { key: undefined as undefined | "file" | "text" | "qa", label: "Tous" },
  { key: "file" as const, label: "Fichiers" },
  { key: "text" as const, label: "Textes" },
  { key: "qa" as const, label: "Q&R" },
];

export function HistoryList() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [type, setType] = useState<"file" | "text" | "qa" | undefined>(undefined);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<KnowledgeItem | null>(null);

  // Debounce search input.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  // Reset page when filters change.
  useEffect(() => {
    setPage(1);
  }, [debouncedQ, type]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (debouncedQ) params.set("q", debouncedQ);
      params.set("page", String(page));
      params.set("limit", "20");
      const r = await fetch(`/api/knowledge/items?${params.toString()}`);
      const j = await r.json();
      setItems(j.items ?? []);
      setTotalPages(j.totalPages ?? 1);
      setTotal(j.total ?? 0);
    } catch {
      toast.error("Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedQ, type]);

  // Poll for items still indexing — re-fetch every 5 s as long as at least
  // one item is non-terminal (anything other than `completed` / `failed`).
  // The server-side lazy reconcile in /api/knowledge/items will pick up
  // the real OpenAI status on each refetch, so the badge eventually
  // settles even for files that take more than 60 s to index. Single
  // ref-guarded interval : we always clear the previous timer before
  // deciding whether to schedule a new one, which avoids stacked
  // intervals when filters change concurrently with a poll tick.
  const pollerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (pollerRef.current) {
      clearInterval(pollerRef.current);
      pollerRef.current = null;
    }
    const hasPending = items.some(
      (it) => it.status !== "completed" && it.status !== "failed"
    );
    if (!hasPending) return;
    pollerRef.current = setInterval(() => {
      void load();
    }, 5000);
    return () => {
      if (pollerRef.current) {
        clearInterval(pollerRef.current);
        pollerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  async function deleteItem(item: KnowledgeItem) {
    const label =
      item.type === "qa"
        ? (item.question ?? "Q&R")
        : (item.title ?? item.file_name);
    if (!confirm(`Supprimer « ${label.substring(0, 80)} » ?`)) return;
    const r = await fetch(`/api/knowledge/items/${item.id}`, { method: "DELETE" });
    if (r.ok) {
      toast.success("Supprimé");
      load();
    } else {
      toast.error("Erreur lors de la suppression");
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">Historique</h2>
        <div className="text-xs text-zinc-500">
          {total} élément{total !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setType(f.key)}
            className={
              type === f.key
                ? "px-3 py-1.5 rounded-md bg-zinc-900 text-white text-xs"
                : "px-3 py-1.5 rounded-md hover:bg-zinc-100 text-xs text-zinc-700 border"
            }
          >
            {f.label}
          </button>
        ))}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <Input
            placeholder="Rechercher question, réponse, titre, fichier…"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {debouncedQ
            ? "Aucun résultat."
            : "Aucun élément pour cette école."}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <Card key={it.id} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <ItemIcon type={it.type} />
                  <div className="flex-1 min-w-0">
                    {it.type === "qa" ? (
                      <>
                        <p className="font-medium truncate">
                          {it.question ?? "(sans question)"}
                        </p>
                        <p className="text-sm text-zinc-600 truncate mt-0.5">
                          {it.answer}
                        </p>
                        {(it.theme_name || it.subtheme_name) && (
                          <p className="text-xs text-zinc-500 mt-1">
                            {[it.theme_name, it.subtheme_name]
                              .filter(Boolean)
                              .join(" › ")}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="font-medium truncate">
                          {it.title ?? it.file_name}
                        </p>
                        <p className="text-xs text-zinc-500 truncate">
                          {it.file_name}
                        </p>
                      </>
                    )}
                    <p className="text-xs text-zinc-400 mt-1 flex items-center gap-2">
                      <span>
                        {new Date(it.uploaded_at).toLocaleString("fr-FR")}
                      </span>
                      <StatusBadge status={it.status} />
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {it.type === "qa" && (
                    <button
                      onClick={() => setEditing(it)}
                      className="p-1.5 rounded hover:bg-zinc-100"
                      aria-label="Modifier"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => deleteItem(it)}
                    className="p-1.5 rounded hover:bg-red-50 text-red-600"
                    aria-label="Supprimer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ‹ Précédent
          </Button>
          <span className="text-sm text-zinc-500 mx-2">
            Page {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Suivant ›
          </Button>
        </div>
      )}

      <EditQaDialog
        item={editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </section>
  );
}

function ItemIcon({ type }: { type: KnowledgeItem["type"] }) {
  const cls = "h-5 w-5 text-zinc-500 shrink-0 mt-0.5";
  if (type === "qa") return <MessageSquareText className={cls} />;
  if (type === "text") return <FileType className={cls} />;
  return <FileText className={cls} />;
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === "completed") return null;
  if (status === "failed") {
    return (
      <span className="text-red-600 bg-red-50 px-1.5 py-0.5 rounded text-[10px]">
        Indexation échouée
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded text-[10px]">
      <Loader2 className="h-2.5 w-2.5 animate-spin" /> Indexation en cours
    </span>
  );
}
