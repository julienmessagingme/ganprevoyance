"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload } from "lucide-react";

const MAX_BYTES = 10 * 1024 * 1024;

export function UploadFileTab({ onUploaded }: { onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function pickFile(f: File | null) {
    if (!f) return setFile(null);
    if (f.size > MAX_BYTES) {
      toast.error("Fichier trop volumineux (max 10 Mo).");
      return;
    }
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "txt"].includes(ext)) {
      toast.error("Extension non supportée. Acceptés : .pdf, .txt");
      return;
    }
    setFile(f);
  }

  async function submit() {
    if (!file) return;
    setSubmitting(true);
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/knowledge/upload-file", {
      method: "POST",
      body: fd,
    });
    setSubmitting(false);
    if (r.ok) {
      toast.success(`« ${file.name} » ajouté à la base`);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      onUploaded();
    } else {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      toast.error(j.error ?? "Erreur lors de l'upload");
    }
  }

  return (
    <div className="space-y-4">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pickFile(e.dataTransfer.files[0] ?? null);
        }}
        className={
          "border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors " +
          (dragOver
            ? "border-zinc-900 bg-zinc-50"
            : "border-zinc-300 hover:border-zinc-500")
        }
      >
        <Upload className="h-10 w-10 mx-auto text-zinc-400 mb-3" />
        <p className="font-medium">
          Cliquez ou glissez votre fichier PDF ou TXT
        </p>
        <p className="text-xs text-zinc-500 mt-1">
          Acceptés : .pdf, .txt — max 10 Mo
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.txt"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {file && (
        <div className="flex items-center justify-between bg-zinc-50 border rounded-lg p-3">
          <div className="text-sm">
            <p className="font-medium truncate">{file.name}</p>
            <p className="text-zinc-500 text-xs">
              {(file.size / 1024).toFixed(1)} Ko
            </p>
          </div>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Upload…" : "Ajouter"}
          </Button>
        </div>
      )}
    </div>
  );
}
