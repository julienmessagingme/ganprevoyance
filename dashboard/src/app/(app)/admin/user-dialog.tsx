"use client";

import { useEffect, useState } from "react";
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
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { SCHOOLS } from "@/lib/schools";
import type { AdminUser } from "@/lib/admin/types";

const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&";

function generateTempPassword(length = 16): string {
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[arr[i] % PASSWORD_ALPHABET.length];
  }
  return out;
}

interface Props {
  mode: "create" | "edit";
  user?: AdminUser;
  onClose: () => void;
  onSaved: () => void;
}

export function UserDialog({ mode, user, onClose, onSaved }: Props) {
  const [email, setEmail] = useState(user?.email ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [password, setPassword] = useState(() =>
    mode === "create" ? generateTempPassword() : ""
  );
  const [isAdmin, setIsAdmin] = useState(user?.is_admin ?? false);
  const [schools, setSchools] = useState<Set<string>>(
    () => new Set(user?.schools ?? SCHOOLS.map((s) => s.slug))
  );
  const [submitting, setSubmitting] = useState(false);

  // Reset whenever the dialog re-opens with a different user
  useEffect(() => {
    if (mode === "edit" && user) {
      setEmail(user.email);
      setName(user.name ?? "");
      setPassword("");
      setIsAdmin(user.is_admin);
      setSchools(new Set(user.schools));
    }
  }, [mode, user]);

  function toggleSchool(slug: string) {
    setSchools((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password);
      toast.success("Mot de passe copié");
    } catch {
      toast.error("Impossible de copier");
    }
  }

  async function submit() {
    setSubmitting(true);
    try {
      if (mode === "create") {
        const r = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            name: name.trim(),
            password,
            is_admin: isAdmin,
            schools: Array.from(schools),
          }),
        });
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        toast.success(
          `Compte créé. Mot de passe : ${password} (à communiquer en sécurité)`,
          { duration: 30_000 }
        );
        onSaved();
        onClose();
      } else if (user) {
        const body: Record<string, unknown> = {
          name: name.trim(),
          is_admin: isAdmin,
          schools: Array.from(schools),
        };
        if (password.trim()) body.password = password;
        const r = await fetch(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        toast.success(
          password.trim()
            ? `Modifié. Nouveau mot de passe : ${password}`
            : "Modifié"
        );
        onSaved();
        onClose();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    name.trim().length > 0 &&
    (mode === "edit" || (email.trim().length > 0 && password.length >= 8));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Inviter un utilisateur" : `Modifier ${user?.email}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={mode === "edit"}
              placeholder="prenom.nom@ganprevoyance.fr"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="name">Nom</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="password">
              {mode === "create" ? "Mot de passe temporaire" : "Nouveau mot de passe (vide = inchangé)"}
            </Label>
            <div className="flex gap-2">
              <Input
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="font-mono"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPassword(generateTempPassword())}
                title="Régénérer"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={copyPassword}
                title="Copier"
                disabled={!password}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            {mode === "create" && (
              <p className="text-xs text-zinc-500">
                À communiquer en sécurité (Slack DM ou en personne) — ne s&apos;affichera plus après.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isAdmin}
                onChange={(e) => setIsAdmin(e.target.checked)}
              />
              <span>Administrateur (peut gérer les utilisateurs)</span>
            </label>
          </div>

          <div className="space-y-1">
            <Label>Écoles accessibles</Label>
            <div className="grid grid-cols-2 gap-1.5 border rounded p-2 max-h-56 overflow-auto">
              {SCHOOLS.map((s) => (
                <label key={s.slug} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={schools.has(s.slug)}
                    onChange={() => toggleSchool(s.slug)}
                  />
                  <span>{s.name}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Annuler
          </Button>
          <Button onClick={submit} disabled={submitting || !canSubmit}>
            {submitting
              ? "Enregistrement…"
              : mode === "create"
              ? "Créer"
              : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
