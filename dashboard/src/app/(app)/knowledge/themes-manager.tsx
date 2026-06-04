"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { Theme, Subtheme } from "./types";

export function ThemesManagerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [subthemes, setSubthemes] = useState<Subtheme[]>([]);
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
  const [newThemeName, setNewThemeName] = useState("");
  const [newSubthemeName, setNewSubthemeName] = useState("");

  async function loadThemes() {
    const r = await fetch("/api/knowledge/themes").then((res) => res.json());
    setThemes(r.themes ?? []);
  }
  async function loadSubthemes() {
    const url = selectedThemeId
      ? `/api/knowledge/subthemes?themeId=${selectedThemeId}`
      : "/api/knowledge/subthemes";
    const r = await fetch(url).then((res) => res.json());
    setSubthemes(r.subthemes ?? []);
  }

  useEffect(() => {
    if (open) loadThemes();
  }, [open]);

  useEffect(() => {
    if (open) loadSubthemes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedThemeId]);

  async function addTheme(e: React.FormEvent) {
    e.preventDefault();
    const name = newThemeName.trim();
    if (!name) return;
    const r = await fetch("/api/knowledge/themes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (r.ok) {
      toast.success("Thème créé");
      setNewThemeName("");
      loadThemes();
    } else {
      const j = (await r.json().catch(() => ({}))) as { message?: string };
      toast.error(j.message ?? "Erreur");
    }
  }

  async function renameTheme(theme: Theme) {
    const name = prompt("Nouveau nom :", theme.name);
    if (!name?.trim() || name === theme.name) return;
    const r = await fetch(`/api/knowledge/themes/${theme.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (r.ok) {
      toast.success("Renommé");
      loadThemes();
    } else {
      toast.error("Erreur");
    }
  }

  async function deleteTheme(theme: Theme) {
    if (
      !confirm(
        `Supprimer le thème « ${theme.name} » ?\n\nLes sous-thèmes liés seront aussi supprimés.\nLes Q&R associées resteront mais perdront leur thème.`
      )
    )
      return;
    const r = await fetch(`/api/knowledge/themes/${theme.id}`, {
      method: "DELETE",
    });
    if (r.ok) {
      toast.success("Thème supprimé");
      if (selectedThemeId === theme.id) setSelectedThemeId(null);
      loadThemes();
      loadSubthemes();
    } else {
      toast.error("Erreur");
    }
  }

  async function addSubtheme(e: React.FormEvent) {
    e.preventDefault();
    const name = newSubthemeName.trim();
    if (!name) return;
    const r = await fetch("/api/knowledge/subthemes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, themeId: selectedThemeId ?? null }),
    });
    if (r.ok) {
      toast.success("Sous-thème créé");
      setNewSubthemeName("");
      loadSubthemes();
    } else {
      const j = (await r.json().catch(() => ({}))) as { message?: string };
      toast.error(j.message ?? "Erreur");
    }
  }

  async function renameSubtheme(s: Subtheme) {
    const name = prompt("Nouveau nom :", s.name);
    if (!name?.trim() || name === s.name) return;
    const r = await fetch(`/api/knowledge/subthemes/${s.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (r.ok) {
      toast.success("Renommé");
      loadSubthemes();
    } else {
      toast.error("Erreur");
    }
  }

  async function deleteSubtheme(s: Subtheme) {
    if (!confirm(`Supprimer le sous-thème « ${s.name} » ?`)) return;
    const r = await fetch(`/api/knowledge/subthemes/${s.id}`, {
      method: "DELETE",
    });
    if (r.ok) {
      toast.success("Supprimé");
      loadSubthemes();
    } else {
      toast.error("Erreur");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Gérer les thèmes</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">Thèmes</h3>
            <form onSubmit={addTheme} className="flex gap-2">
              <Input
                placeholder="Nouveau thème"
                value={newThemeName}
                onChange={(e) => setNewThemeName(e.target.value)}
              />
              <Button type="submit" size="icon" aria-label="Créer">
                <Plus className="h-4 w-4" />
              </Button>
            </form>
            <ul className="space-y-1 max-h-80 overflow-y-auto pr-1">
              {themes.length === 0 && (
                <li className="text-xs text-zinc-500">Aucun thème.</li>
              )}
              {themes.map((t) => (
                <li
                  key={t.id}
                  className={
                    selectedThemeId === t.id
                      ? "flex items-center justify-between rounded p-2 bg-zinc-100"
                      : "flex items-center justify-between rounded p-2 hover:bg-zinc-50 cursor-pointer"
                  }
                  onClick={() => setSelectedThemeId(t.id)}
                >
                  <span className="text-sm truncate">{t.name}</span>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        renameTheme(t);
                      }}
                      className="p-1 rounded hover:bg-zinc-200"
                      aria-label="Renommer"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTheme(t);
                      }}
                      className="p-1 rounded hover:bg-red-100 text-red-600"
                      aria-label="Supprimer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            <h3 className="font-semibold text-sm">
              Sous-thèmes
              {selectedThemeId && (
                <span className="font-normal text-zinc-500">
                  {" "}
                  — {themes.find((t) => t.id === selectedThemeId)?.name}
                </span>
              )}
              {!selectedThemeId && (
                <span className="font-normal text-zinc-500"> — tous</span>
              )}
            </h3>
            <form onSubmit={addSubtheme} className="flex gap-2">
              <Input
                placeholder="Nouveau sous-thème"
                value={newSubthemeName}
                onChange={(e) => setNewSubthemeName(e.target.value)}
              />
              <Button type="submit" size="icon" aria-label="Créer">
                <Plus className="h-4 w-4" />
              </Button>
            </form>
            <ul className="space-y-1 max-h-80 overflow-y-auto pr-1">
              {subthemes.length === 0 && (
                <li className="text-xs text-zinc-500">Aucun sous-thème.</li>
              )}
              {subthemes.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded p-2 hover:bg-zinc-50"
                >
                  <span className="text-sm truncate">{s.name}</span>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => renameSubtheme(s)}
                      className="p-1 rounded hover:bg-zinc-200"
                      aria-label="Renommer"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => deleteSubtheme(s)}
                      className="p-1 rounded hover:bg-red-100 text-red-600"
                      aria-label="Supprimer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
