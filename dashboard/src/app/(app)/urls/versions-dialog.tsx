"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface VersionRow {
  id: string;
  destination_url: string;
  version: number;
  active_from: string;
  active_to: string | null;
  clickCount: number;
}

export function VersionsDialog({
  event,
  onOpenChange,
}: {
  event: { id: string; name: string } | null;
  onOpenChange: (o: boolean) => void;
}) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);

  useEffect(() => {
    if (!event) {
      setVersions(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/events/${event.id}/versions`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setVersions(j.versions ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [event]);

  return (
    <Dialog open={!!event} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Historique des versions — {event?.name}</DialogTitle>
        </DialogHeader>
        {!versions ? (
          <p className="text-sm text-zinc-500">Chargement…</p>
        ) : versions.length === 0 ? (
          <p className="text-sm text-zinc-500">Aucune version.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-auto">
            {versions.map((v) => (
              <div
                key={v.id}
                className={`border rounded p-3 text-sm ${
                  v.active_to === null ? "bg-zinc-50 border-zinc-300" : ""
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-medium">
                    v{v.version}
                    {v.active_to === null && (
                      <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                        active
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {v.clickCount} clic{v.clickCount !== 1 ? "s" : ""}
                  </span>
                </div>
                <p className="text-zinc-600 text-xs mt-1 break-all">
                  → {v.destination_url}
                </p>
                <p className="text-xs text-zinc-400 mt-1">
                  Active du{" "}
                  {new Date(v.active_from).toLocaleString("fr-FR")}
                  {v.active_to
                    ? ` au ${new Date(v.active_to).toLocaleString("fr-FR")}`
                    : " à maintenant"}
                </p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
