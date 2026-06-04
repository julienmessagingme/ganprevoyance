"use client";

import { useEffect, useState, useCallback } from "react";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pencil, UserMinus, UserCheck, ShieldCheck } from "lucide-react";
import { SCHOOLS } from "@/lib/schools";
import type { AdminUser } from "@/lib/admin/types";
import { UserDialog } from "./user-dialog";

function timeAgo(iso: string | null): string {
  if (!iso) return "jamais";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString("fr-FR");
}

export function AdminClient({ meId }: { meId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/users");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { users: AdminUser[] };
      setUsers(j.users);
    } catch {
      toast.error("Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setDeactivated(u: AdminUser, deactivate: boolean) {
    if (deactivate) {
      if (!confirm(`Désactiver ${u.email} ? Il/elle ne pourra plus se connecter.`))
        return;
      const r = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
      if (r.ok) {
        toast.success("Désactivé");
        load();
      } else {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Erreur");
      }
    } else {
      const r = await fetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deactivated_at: null }),
      });
      if (r.ok) {
        toast.success("Réactivé");
        load();
      } else {
        toast.error("Erreur");
      }
    }
  }

  return (
    <div className="space-y-4">
      <Toaster richColors position="top-right" />
      <header className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Administration des utilisateurs</h2>
        <Button onClick={() => setCreatingNew(true)}>+ Inviter</Button>
      </header>

      {loading ? (
        <p className="text-zinc-500">Chargement…</p>
      ) : users.length === 0 ? (
        <p className="text-zinc-500">Aucun utilisateur (cas impossible).</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {users.map((u) => {
            const isMe = u.id === meId;
            const isDeactivated = !!u.deactivated_at;
            return (
              <Card key={u.id} className={`p-4 ${isDeactivated ? "opacity-70" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{u.name ?? u.email}</span>
                      {u.is_admin && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-900 text-white inline-flex items-center gap-1">
                          <ShieldCheck className="h-3 w-3" /> Admin
                        </span>
                      )}
                      {!u.is_admin && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700">
                          Member
                        </span>
                      )}
                      {isMe && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                          Vous
                        </span>
                      )}
                      {isDeactivated && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                          Désactivé
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-600 truncate">{u.email}</p>
                    <p className="text-xs text-zinc-500">
                      Dernière connexion : {timeAgo(u.last_login_at)}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {u.schools.length === 0 ? (
                        <span className="text-xs text-zinc-400 italic">
                          Aucune école assignée
                        </span>
                      ) : (
                        u.schools.slice(0, 6).map((s) => {
                          const meta = SCHOOLS.find((x) => x.slug === s);
                          return (
                            <span
                              key={s}
                              className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700"
                            >
                              {meta?.name ?? s}
                            </span>
                          );
                        })
                      )}
                      {u.schools.length > 6 && (
                        <span className="text-xs text-zinc-500">
                          +{u.schools.length - 6}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      onClick={() => setEditing(u)}
                      className="p-1.5 rounded hover:bg-zinc-100"
                      aria-label="Modifier"
                      title="Modifier"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {!isMe &&
                      (isDeactivated ? (
                        <button
                          onClick={() => setDeactivated(u, false)}
                          className="p-1.5 rounded hover:bg-zinc-100 text-zinc-700"
                          aria-label="Réactiver"
                          title="Réactiver"
                        >
                          <UserCheck className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => setDeactivated(u, true)}
                          className="p-1.5 rounded hover:bg-red-50 text-red-600"
                          aria-label="Désactiver"
                          title="Désactiver"
                        >
                          <UserMinus className="h-4 w-4" />
                        </button>
                      ))}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {creatingNew && (
        <UserDialog
          mode="create"
          onClose={() => setCreatingNew(false)}
          onSaved={load}
        />
      )}
      {editing && (
        <UserDialog
          mode="edit"
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
