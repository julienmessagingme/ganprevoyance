"use client";

import type { ComputedStep } from "@/lib/dashboards/types";
import { compactStepLabel } from "@/lib/dashboards/types";
import { PIE_COLORS } from "./pie-chart";

function pct(num: number, denom: number): string {
  if (denom === 0) return "—";
  return `${((num / denom) * 100).toFixed(1)}%`;
}

/**
 * Table récap pour un dashboard de type `pie`. Affiche par part : label,
 * volume, et pourcentage du total (base 100). Le breakdown détaillé des
 * refs reste rendu indenté sous chaque part quand l'étape en cumule
 * plusieurs — mêmes données structurelles qu'un funnel, juste les colonnes
 * de conversion remplacées par une seule colonne `% du total`.
 */
export function PieTable({ steps }: { steps: ComputedStep[] }) {
  if (steps.length === 0) return null;
  const total = steps.reduce(
    (acc, s) => (s.available ? acc + s.count : acc),
    0
  );
  // Couleur par part, alignée EXACTEMENT sur le pie : seules les parts
  // disponibles non-vides sont colorées, dans le même ordre (le pie filtre pareil).
  let ci = 0;
  const stepColors = steps.map((s) =>
    s.available && s.count > 0 ? PIE_COLORS[ci++ % PIE_COLORS.length] : null
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-zinc-500 border-b">
          <tr>
            <th className="py-2 pr-4">Part</th>
            <th className="py-2 pr-4 text-right">Volume</th>
            <th className="py-2 pr-4 text-right">% du total</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => {
            const showBreakdown = s.refs.length > 1;
            return (
              <tr
                key={`step-${s.position}`}
                className={`border-b align-top ${!s.available ? "opacity-50" : ""}`}
              >
                <td className="py-2 pr-4">
                  <div>
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle"
                      style={{ backgroundColor: stepColors[i] ?? "#d4d4d8" }}
                    />
                    <span className="text-zinc-400 mr-2">{i + 1}.</span>
                    {compactStepLabel(s)}
                    {!s.available && (
                      <span className="ml-2 text-xs text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                        indisponible
                      </span>
                    )}
                  </div>
                  {showBreakdown && (
                    <ul className="mt-1 ml-6 text-xs text-zinc-500 space-y-0.5">
                      {s.refs.map((r, ri) => (
                        <li
                          key={`${ri}-${r.ref_id}`}
                          className={`flex justify-between gap-4 ${
                            !r.available ? "opacity-60" : ""
                          }`}
                        >
                          <span className="truncate">
                            <span className="text-zinc-400 mr-1">·</span>
                            {r.label}
                            {!r.available && (
                              <span className="ml-1 text-amber-700">(indispo)</span>
                            )}
                          </span>
                          <span className="tabular-nums">{r.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">{s.count}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-zinc-600">
                  {s.available ? pct(s.count, total) : "—"}
                </td>
              </tr>
            );
          })}
          <tr className="font-semibold border-t-2 border-zinc-300">
            <td className="py-2 pr-4">Total</td>
            <td className="py-2 pr-4 text-right tabular-nums">{total}</td>
            <td className="py-2 pr-4 text-right tabular-nums text-zinc-600">
              100,0%
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
