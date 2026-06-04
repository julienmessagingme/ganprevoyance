"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Toaster } from "sonner";
import { UploadFileTab } from "./upload-file-tab";
import { UploadTextTab } from "./upload-text-tab";
import { UploadQaTab } from "./upload-qa-tab";
import { UploadExcelTab } from "./upload-excel-tab";
import { HistoryList } from "./history-list";
import { ThemesManagerDialog } from "./themes-manager";

type SubTab = "file" | "text" | "qa" | "excel";

const TABS: { key: SubTab; label: string }[] = [
  { key: "file", label: "Fichier PDF/TXT" },
  { key: "text", label: "Saisie manuelle" },
  { key: "qa", label: "Question / Réponse" },
  { key: "excel", label: "Import Excel" },
];

export function KnowledgeClient({
  schoolSlug,
  schoolName,
}: {
  schoolSlug: string;
  schoolName: string;
}) {
  const [tab, setTab] = useState<SubTab>("file");
  const [openThemesManager, setOpenThemesManager] = useState(false);
  // Bumped after each successful upload so HistoryList re-fetches.
  const [historyVersion, setHistoryVersion] = useState(0);
  const onUploaded = () => setHistoryVersion((v) => v + 1);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <Toaster richColors position="top-right" />

      <header className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Base de connaissance</h1>
          <p className="text-sm text-zinc-500">
            École : <strong>{schoolName}</strong>
          </p>
        </div>
        <Button variant="outline" onClick={() => setOpenThemesManager(true)}>
          Gérer les thèmes
        </Button>
      </header>

      <div className="bg-white rounded-lg border shadow-sm">
        <div className="flex gap-1 px-4 pt-3 border-b overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                tab === t.key
                  ? "px-4 py-2 text-sm font-medium border-b-2 border-zinc-900 text-zinc-900 -mb-px whitespace-nowrap"
                  : "px-4 py-2 text-sm font-medium text-zinc-500 hover:text-zinc-900 -mb-px whitespace-nowrap"
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="p-6">
          {tab === "file" && <UploadFileTab onUploaded={onUploaded} />}
          {tab === "text" && <UploadTextTab onUploaded={onUploaded} />}
          {tab === "qa" && (
            <UploadQaTab schoolSlug={schoolSlug} onUploaded={onUploaded} />
          )}
          {tab === "excel" && <UploadExcelTab onUploaded={onUploaded} />}
        </div>
      </div>

      <HistoryList key={`${schoolSlug}-${historyVersion}`} />

      <ThemesManagerDialog
        open={openThemesManager}
        onOpenChange={setOpenThemesManager}
      />
    </div>
  );
}
