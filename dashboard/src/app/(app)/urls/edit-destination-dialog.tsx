"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface MinimalEvent {
  id: string;
  name: string;
  currentVersion: { destination_url: string; version: number } | null;
}

export function EditDestinationDialog({
  event,
  onOpenChange,
  onSaved,
}: {
  event: MinimalEvent | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setUrl(event?.currentVersion?.destination_url ?? "");
  }, [event]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!event) return;
    setSubmitting(true);
    const r = await fetch(`/api/events/${event.id}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destinationUrl: url }),
    });
    setSubmitting(false);
    if (r.ok) {
      const j = await r.json();
      toast.success(`Nouvelle version v${j.version}`);
      onSaved();
    } else {
      const j = await r.json().catch(() => ({}));
      toast.error(j.error ?? "Erreur");
    }
  }

  return (
    <Dialog open={!!event} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier la destination — {event?.name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-zinc-500">
          Le slug ne change pas. Une nouvelle version est créée et tous les
          clics futurs lui sont attribués. La version actuelle (v
          {event?.currentVersion?.version ?? "?"}) restera dans l&apos;historique.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dest-url">Nouvelle URL</Label>
            <Input
              id="dest-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              autoFocus
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
