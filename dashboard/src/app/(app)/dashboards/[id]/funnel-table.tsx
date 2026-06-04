"use client";

import type {
  ComputedStep,
  MetaCostBreakdownItem,
  CampaignCostSummary,
} from "@/lib/dashboards/types";
import { compactStepLabel } from "@/lib/dashboards/types";
import { MetaCostButton } from "@/components/meta-cost-breakdown";

function pct(num: number, denom: number): string {
  if (denom === 0) return "—";
  return `${((num / denom) * 100).toFixed(1)}%`;
}

/** Fusionne plusieurs breakdowns en un seul (utilisé pour la ligne
 *  « Total coût Meta » qui agrège tous les steps). */
function mergeBreakdowns(
  steps: ComputedStep[]
): MetaCostBreakdownItem[] {
  const merged = new Map<string, MetaCostBreakdownItem>();
  for (const s of steps) {
    for (const b of s.meta_breakdown ?? []) {
      const existing = merged.get(b.iso);
      if (existing) {
        existing.count += b.count;
        existing.total_eur += b.total_eur;
      } else {
        merged.set(b.iso, { ...b });
      }
    }
  }
  return Array.from(merged.values()).sort(
    (a, b) => b.total_eur - a.total_eur
  );
}

export function FunnelTable({
  steps: rawSteps,
  campaignSummary = null,
}: {
  steps: ComputedStep[];
  campaignSummary?: CampaignCostSummary | null;
}) {
  if (rawSteps.length === 0) return null;
  // Le step "Échec" synthétique n'est pas rendu comme une ligne séparée :
  // son volume est affiché en sous-ligne du step "Lancement" (équivalent
  // d'un breakdown multi-refs). Le coût Meta de l'échec reste 0 (le coût
  // brut est sur le launch) donc rien à reporter côté coûts.
  const failedStep = rawSteps.find((s) => s.synth_role === "failed") ?? null;
  const steps = rawSteps.filter((s) => s.synth_role !== "failed");
  const first = steps[0]?.count ?? 0;
  // Si on a une synthèse campagne avec failed, le coût Meta affiché pour
  // le step Lancement doit être le NET (lancement − failed), pas le brut.
  // Sinon le tableau et l'encadré du haut affichent 2 chiffres différents
  // (brut 68,60 € en bas vs net 61,99 € en haut).
  const useNetForLaunch =
    campaignSummary !== null && campaignSummary.failed !== null;
  // Effective cost per step : remplace le brut par le net pour le launch.
  const stepCost = (s: ComputedStep): number | null => {
    if (useNetForLaunch && s.synth_role === "launch") {
      return campaignSummary?.net_cost_eur ?? null;
    }
    return s.meta_cost_eur ?? null;
  };
  const stepBreakdown = (
    s: ComputedStep
  ): MetaCostBreakdownItem[] | undefined => {
    if (useNetForLaunch && s.synth_role === "launch") {
      return campaignSummary?.net_breakdown ?? undefined;
    }
    return s.meta_breakdown;
  };
  // Colonne « Coût Meta » affichée uniquement si au moins une étape porte
  // un coût. Évite une colonne vide dans 99 % des funnels.
  const hasMetaCost = steps.some((s) => {
    const c = stepCost(s);
    return c != null && c > 0;
  });
  const totalMetaCost = hasMetaCost
    ? steps.reduce((acc, s) => acc + (stepCost(s) ?? 0), 0)
    : 0;
  const totalBreakdown = hasMetaCost
    ? mergeBreakdowns(
        steps.map((s) => ({
          ...s,
          meta_cost_eur: stepCost(s),
          meta_breakdown: stepBreakdown(s),
        }))
      )
    : [];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-zinc-500 border-b">
          <tr>
            <th className="py-2 pr-4">Étape</th>
            <th className="py-2 pr-4 text-right">Volume</th>
            <th className="py-2 pr-4 text-right">Conv. vs précédent</th>
            <th className="py-2 pr-4 text-right">Conv. vs étape 1</th>
            {hasMetaCost && (
              <th
                className="py-2 pr-4 text-right"
                title="Coût Meta WhatsApp marketing estimé, calculé par indicatif pays sur les events porteurs d'un numéro de tel"
              >
                Coût Meta
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => {
            const prev = i === 0 ? null : steps[i - 1].count;
            const showBreakdown = s.refs.length > 1;
            // Sous-ligne "failed" affichée sous le step Lancement.
            const showFailedAnnotation =
              s.synth_role === "launch" && failedStep && failedStep.available;
            return (
              <tr
                key={`step-${s.position}`}
                className={`border-b align-top ${!s.available ? "opacity-50" : ""}`}
              >
                <td className="py-2 pr-4">
                  <div>
                    <span className="text-zinc-400 mr-2">{i + 1}.</span>
                    {compactStepLabel(s)}
                    {!s.available && (
                      <span className="ml-2 text-xs text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                        indisponible
                      </span>
                    )}
                  </div>
                  {showFailedAnnotation && failedStep && (
                    <ul className="mt-1 ml-6 text-xs text-red-600 space-y-0.5">
                      <li className="flex justify-between gap-4">
                        <span className="truncate">
                          <span className="text-red-400 mr-1">−</span>
                          {failedStep.label.replace(/^Échec\s*:\s*/, "")} (failed WhatsApp)
                        </span>
                        <span className="tabular-nums flex items-baseline gap-2 shrink-0">
                          <span>{failedStep.count}</span>
                          {s.count > 0 && (
                            <span className="text-red-400 text-[10px]">
                              ({((failedStep.count / s.count) * 100).toFixed(1)}%)
                            </span>
                          )}
                        </span>
                      </li>
                      <li className="flex justify-between gap-4 text-zinc-600 font-medium">
                        <span className="truncate">
                          <span className="text-zinc-400 mr-1">=</span>
                          Envois réussis (net)
                        </span>
                        <span className="tabular-nums shrink-0">
                          {(s.count - failedStep.count).toLocaleString("fr-FR")}
                        </span>
                      </li>
                    </ul>
                  )}
                  {showBreakdown && (
                    <ul className="mt-1 ml-6 text-xs text-zinc-500 space-y-0.5">
                      {s.refs.map((r, ri) => {
                        // % de la ref dans l'étape parent : 458/1089 → 42.1%.
                        // Vide pour les refs indisponibles ou si l'étape
                        // totalise 0 (division par zéro).
                        const refPct =
                          r.available && s.count > 0
                            ? `${((r.count / s.count) * 100).toFixed(1)}%`
                            : null;
                        return (
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
                            <span className="tabular-nums flex items-baseline gap-2 shrink-0">
                              <span>{r.count}</span>
                              {refPct && (
                                <span className="text-zinc-400 text-[10px]">
                                  ({refPct})
                                </span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">{s.count}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-zinc-600">
                  {prev === null ? "—" : pct(s.count, prev)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-zinc-600">
                  {i === 0 ? "—" : pct(s.count, first)}
                </td>
                {hasMetaCost &&
                  (() => {
                    const cost = stepCost(s);
                    const breakdown = stepBreakdown(s);
                    const isNetOverride =
                      useNetForLaunch && s.synth_role === "launch";
                    return (
                      <td className="py-2 pr-4 text-right tabular-nums text-zinc-600">
                        {cost != null && cost > 0 ? (
                          <div className="flex flex-col items-end">
                            <MetaCostButton
                              amountEur={cost}
                              breakdown={breakdown}
                              title={`Coût Meta — étape ${i + 1} (${compactStepLabel(s)})`}
                            />
                            {isNetOverride && (
                              <span className="text-[10px] text-zinc-400">
                                net (brut{" "}
                                {(s.meta_cost_eur ?? 0)
                                  .toLocaleString("fr-FR", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{" "}
                                €)
                              </span>
                            )}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    );
                  })()}
              </tr>
            );
          })}
          {hasMetaCost && (
            <tr className="font-semibold border-t-2 border-zinc-300">
              <td className="py-2 pr-4">Total coût Meta</td>
              <td className="py-2 pr-4" />
              <td className="py-2 pr-4" />
              <td className="py-2 pr-4" />
              <td className="py-2 pr-4 text-right tabular-nums">
                <MetaCostButton
                  amountEur={totalMetaCost}
                  breakdown={totalBreakdown}
                  title="Coût Meta — total du funnel"
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
