"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, X } from "lucide-react";
import { toast } from "sonner";

const NONE_VALUE = "__none__";

interface ParsedSheet {
  name: string;
  rows: (string | number | null)[][];
}

interface SsePair {
  question: string;
  answer: string;
  theme?: string;
  subtheme?: string;
}

interface Progress {
  successes: number;
  failures: { index: number; question: string; error: string }[];
  retries: number;
  done: boolean;
  current?: string;
}

export function UploadExcelTab({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [hasHeaders, setHasHeaders] = useState(true);
  const [colQuestion, setColQuestion] = useState<number | null>(null);
  const [colAnswer, setColAnswer] = useState<number | null>(null);
  const [colTheme, setColTheme] = useState<number | null>(null);
  const [colSubtheme, setColSubtheme] = useState<number | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [total, setTotal] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const sheet = sheets.find((s) => s.name === activeSheet);
  const headerRow = sheet && hasHeaders ? sheet.rows[0] : null;
  const dataRows = sheet ? sheet.rows.slice(hasHeaders ? 1 : 0) : [];

  function reset() {
    setFileName(null);
    setSheets([]);
    setActiveSheet(null);
    setColQuestion(null);
    setColAnswer(null);
    setColTheme(null);
    setColSubtheme(null);
    setProgress(null);
    setTotal(0);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function pickFile(f: File | null) {
    if (!f) return;
    const buffer = await f.arrayBuffer();
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(buffer, { type: "array" });
    } catch (err) {
      toast.error(
        "Lecture du fichier échouée : " +
          (err instanceof Error ? err.message : "format invalide")
      );
      return;
    }
    const parsed: ParsedSheet[] = wb.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json<(string | number | null)[]>(
        wb.Sheets[name],
        { header: 1, defval: "", blankrows: false }
      ),
    })).filter((s) => s.rows.length > 0);

    if (parsed.length === 0) {
      toast.error("Aucune feuille avec données dans ce fichier.");
      return;
    }
    setFileName(f.name);
    setSheets(parsed);
    setActiveSheet(parsed[0].name);
  }

  function buildPairs(): SsePair[] {
    if (!sheet || colQuestion == null || colAnswer == null) return [];
    const out: SsePair[] = [];
    for (const row of dataRows) {
      const q = String(row[colQuestion] ?? "").trim();
      const a = String(row[colAnswer] ?? "").trim();
      if (!q || !a) continue;
      const pair: SsePair = { question: q, answer: a };
      if (colTheme != null) {
        const t = String(row[colTheme] ?? "").trim();
        if (t) pair.theme = t;
      }
      if (colSubtheme != null) {
        const s = String(row[colSubtheme] ?? "").trim();
        if (s) pair.subtheme = s;
      }
      out.push(pair);
    }
    return out;
  }

  async function startImport() {
    const pairs = buildPairs();
    if (pairs.length === 0) {
      toast.error(
        "Aucune ligne valide. Vérifie les colonnes Question et Réponse."
      );
      return;
    }
    setTotal(pairs.length);
    setProgress({ successes: 0, failures: [], retries: 0, done: false });

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let r: Response;
    try {
      r = await fetch("/api/knowledge/import-excel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pairs }),
        signal: ctrl.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      toast.error("Connexion au serveur échouée");
      setProgress(null);
      return;
    }

    if (!r.ok || !r.body) {
      toast.error("Import refusé par le serveur");
      setProgress(null);
      return;
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Server-sent events are framed by blank lines.
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? ""; // last (possibly incomplete) event

        for (const block of events) {
          for (const line of block.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              handleEvent(evt);
            } catch {
              // ignore malformed event
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error("Erreur lors du streaming");
      }
    }

    abortRef.current = null;
    onUploaded();
  }

  function handleEvent(
    e: {
      type: string;
      successes?: number;
      failureCount?: number;
      error?: string;
      question?: string;
      summary?: { successes: number; failures: unknown[]; retries: unknown[] };
      createdThemes?: string[];
      createdSubthemes?: string[];
    }
  ) {
    setProgress((prev) => {
      const cur = prev ?? { successes: 0, failures: [], retries: 0, done: false };
      if (e.type === "themes_created") {
        const ct = e.createdThemes ?? [];
        const cs = e.createdSubthemes ?? [];
        if (ct.length > 0 || cs.length > 0) {
          toast.success(
            `${ct.length} thème${ct.length > 1 ? "s" : ""} et ${cs.length} sous-thème${cs.length > 1 ? "s" : ""} créés`
          );
        }
      }
      if (e.type === "progress") {
        return { ...cur, current: e.question };
      }
      if (e.type === "success") {
        return { ...cur, successes: e.successes ?? cur.successes + 1 };
      }
      if (e.type === "failure") {
        return {
          ...cur,
          failures: [
            ...cur.failures,
            {
              index: cur.failures.length,
              question: e.question ?? "",
              error: e.error ?? "Erreur",
            },
          ],
        };
      }
      if (e.type === "retry") {
        return { ...cur, retries: cur.retries + 1 };
      }
      if (e.type === "done") {
        toast.success(
          `Import terminé : ${e.summary?.successes ?? 0} ajouts, ${e.summary?.failures?.length ?? 0} erreurs`
        );
        return { ...cur, done: true, current: undefined };
      }
      if (e.type === "fatal") {
        toast.error(e.error ?? "Erreur fatale");
        return { ...cur, done: true };
      }
      return cur;
    });
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setProgress(null);
    toast.message("Import annulé");
  }

  const importing = !!progress && !progress.done;
  const canStart =
    sheet &&
    colQuestion != null &&
    colAnswer != null &&
    !importing;

  return (
    <div className="space-y-4">
      {!fileName ? (
        <div
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-zinc-300 hover:border-zinc-500 rounded-lg p-10 text-center cursor-pointer transition-colors"
        >
          <Upload className="h-10 w-10 mx-auto text-zinc-400 mb-3" />
          <p className="font-medium">Cliquez ou glissez un fichier Excel</p>
          <p className="text-xs text-zinc-500 mt-1">.xlsx ou .xls</p>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-zinc-50 border rounded p-3">
            <div className="text-sm">
              <p className="font-medium">{fileName}</p>
              <p className="text-zinc-500 text-xs">
                {sheets.length} feuille{sheets.length > 1 ? "s" : ""}, {dataRows.length} ligne
                {dataRows.length > 1 ? "s" : ""} de données
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={reset}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {sheets.length > 1 && (
            <div className="space-y-2">
              <Label>Feuille</Label>
              <Select
                value={activeSheet ?? ""}
                onValueChange={(v) => setActiveSheet(v)}
              >
                <SelectTrigger>
                  <SelectValue>{(v: string | null) => v ?? ""}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {sheets.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="has-headers"
              checked={hasHeaders}
              onChange={(e) => setHasHeaders(e.target.checked)}
              className="h-4 w-4"
            />
            <Label htmlFor="has-headers" className="cursor-pointer">
              La première ligne contient les en-têtes
            </Label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ColumnSelect
              label="Colonne Question *"
              value={colQuestion}
              onChange={setColQuestion}
              row={headerRow}
              maxCols={sheet?.rows[0]?.length ?? 0}
              required
            />
            <ColumnSelect
              label="Colonne Réponse *"
              value={colAnswer}
              onChange={setColAnswer}
              row={headerRow}
              maxCols={sheet?.rows[0]?.length ?? 0}
              required
            />
            <ColumnSelect
              label="Colonne Thème (optionnel)"
              value={colTheme}
              onChange={setColTheme}
              row={headerRow}
              maxCols={sheet?.rows[0]?.length ?? 0}
            />
            <ColumnSelect
              label="Colonne Sous-thème (optionnel)"
              value={colSubtheme}
              onChange={setColSubtheme}
              row={headerRow}
              maxCols={sheet?.rows[0]?.length ?? 0}
            />
          </div>

          {sheet && colQuestion != null && colAnswer != null && (
            <div className="space-y-2">
              <Label>Aperçu (5 premières lignes)</Label>
              <div className="border rounded overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-100">
                    <tr>
                      <th className="p-2 text-left">Question</th>
                      <th className="p-2 text-left">Réponse</th>
                      {colTheme != null && (
                        <th className="p-2 text-left">Thème</th>
                      )}
                      {colSubtheme != null && (
                        <th className="p-2 text-left">Sous-thème</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {dataRows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2 truncate max-w-xs">
                          {String(r[colQuestion] ?? "")}
                        </td>
                        <td className="p-2 truncate max-w-xs">
                          {String(r[colAnswer] ?? "")}
                        </td>
                        {colTheme != null && (
                          <td className="p-2">{String(r[colTheme] ?? "")}</td>
                        )}
                        {colSubtheme != null && (
                          <td className="p-2">
                            {String(r[colSubtheme] ?? "")}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!progress ? (
            <Button onClick={startImport} disabled={!canStart}>
              Importer {buildPairs().length || dataRows.length} lignes
            </Button>
          ) : (
            <ProgressPanel progress={progress} total={total} onCancel={cancel} />
          )}
        </div>
      )}
    </div>
  );
}

function ColumnSelect({
  label,
  value,
  onChange,
  row,
  maxCols,
  required,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  row: (string | number | null)[] | null | undefined;
  maxCols: number;
  required?: boolean;
}) {
  /**
   * Display label for column index `i` : either the header cell (if there
   * are headers) or a generic "Colonne A/B/C…" fallback.
   */
  const labelForCol = (i: number) =>
    row && row[i] != null && String(row[i]).length > 0
      ? String(row[i]).substring(0, 60)
      : `Colonne ${String.fromCharCode(65 + i)}`;

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select
        value={value == null ? NONE_VALUE : String(value)}
        onValueChange={(v) => {
          if (v === null || v === NONE_VALUE) {
            onChange(null);
            return;
          }
          onChange(parseInt(v, 10));
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder={required ? "À choisir" : "Aucune"}>
            {(v: string | null) => {
              if (v == null || v === NONE_VALUE) {
                return required ? "À choisir" : "— Aucune —";
              }
              const idx = parseInt(v, 10);
              return Number.isNaN(idx) ? v : labelForCol(idx);
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {!required && <SelectItem value={NONE_VALUE}>— Aucune —</SelectItem>}
          {Array.from({ length: maxCols }).map((_, i) => (
            <SelectItem key={i} value={String(i)}>
              {labelForCol(i)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ProgressPanel({
  progress,
  total,
  onCancel,
}: {
  progress: Progress;
  total: number;
  onCancel: () => void;
}) {
  const processed = progress.successes + progress.failures.length;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  return (
    <div className="space-y-2 border rounded p-4 bg-zinc-50">
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm">
          {progress.done
            ? "Import terminé"
            : `Import en cours… ${processed} / ${total}`}
        </p>
        {!progress.done && (
          <Button variant="outline" size="sm" onClick={onCancel}>
            Annuler
          </Button>
        )}
      </div>
      <div className="h-2 bg-zinc-200 rounded overflow-hidden">
        <div
          className="h-full bg-zinc-900 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-zinc-600 flex gap-4">
        <span>✓ {progress.successes} ajoutées</span>
        <span>✗ {progress.failures.length} erreurs</span>
        {progress.retries > 0 && <span>⟳ {progress.retries} retry</span>}
      </div>
      {progress.current && !progress.done && (
        <p className="text-xs text-zinc-500 truncate">
          ⋯ {progress.current}
        </p>
      )}
      {progress.failures.length > 0 && progress.done && (
        <details className="text-xs">
          <summary className="cursor-pointer text-red-600">
            Voir les {progress.failures.length} erreurs
          </summary>
          <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
            {progress.failures.map((f, i) => (
              <li key={i} className="text-zinc-600">
                <strong>{f.question.substring(0, 60)}</strong> → {f.error}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
