"use client";

import { useState } from "react";
import {
  FunnelChart,
  FunnelSeries,
  FunnelArc,
  FunnelAxis,
  FunnelAxisLabel,
  FunnelAxisLine,
} from "reaviz";
import type { ComputedStep } from "@/lib/dashboards/types";

interface FunnelDataPoint {
  key: string;
  data: number;
}

/**
 * Reaviz funnel in a light, editorial container : ivory background with a
 * faint purple halo behind the arc, crisp typography, premium tooltip.
 * Stays light to fit the rest of the dashboard while still letting the
 * purple glow pop.
 */
export function FancyFunnelChart({
  steps: rawSteps,
}: {
  steps: ComputedStep[];
}) {
  const [hovered, setHovered] = useState<
    { index: number; x: number; y: number } | null
  >(null);

  if (rawSteps.length === 0) return null;
  // Le step "Échec" synthétique n'apparaît pas comme une étape de l'entonnoir :
  // son volume est rapporté en sous-ligne du Lancement dans la table.
  const steps = rawSteps.filter((s) => s.synth_role !== "failed");
  if (steps.length === 0) return null;

  // Tronque pour éviter que les labels longs (ex: "Lancement : <event>")
  // débordent visuellement sur l'entonnoir.
  const truncate = (s: string, max = 28): string =>
    s.length <= max ? s : s.slice(0, max - 1) + "…";

  const data: FunnelDataPoint[] = steps.map((s) => ({
    key: `${s.position + 1}. ${truncate(s.label)}`,
    data: s.count,
  }));

  const height = Math.max(260, steps.length * 64);
  const firstCount = data[0]?.data ?? 0;
  const hoveredData = hovered ? data[hovered.index] : null;
  const hoveredVsFirst =
    hovered && firstCount > 0
      ? ((hoveredData!.data / firstCount) * 100).toFixed(1)
      : null;
  const hoveredVsPrev =
    hovered && hovered.index > 0 && data[hovered.index - 1].data > 0
      ? ((hoveredData!.data / data[hovered.index - 1].data) * 100).toFixed(1)
      : null;

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-zinc-200 bg-white shadow-[0_24px_60px_-30px_rgba(91,20,197,0.35),0_2px_8px_-2px_rgba(0,0,0,0.06)]">
      {/* Purple halo behind the arc */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_30%_50%,rgba(168,85,247,0.16),transparent_60%)]"
      />
      {/* Soft accent in the corner */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.18),transparent_70%)] blur-2xl"
      />
      {/* Diagonal flourish */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(135deg, rgba(168,85,247,1) 1px, transparent 1px)",
          backgroundSize: "10px 10px",
        }}
      />

      {/* Header strip */}
      <div className="relative flex items-center justify-between px-5 pt-4 pb-3 border-b border-zinc-100">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.8)]" />
          <span className="text-[10px] uppercase tracking-[0.22em] text-zinc-500 font-semibold">
            Funnel · {steps.length} étape{steps.length > 1 ? "s" : ""}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-400 font-mono">
          Hover pour les détails
        </span>
      </div>

      {/* Chart zone */}
      <div className="relative px-4 py-6" style={{ height: height + 48 }}>
        <FunnelChart
          id="dashboardFunnel"
          height={height}
          data={data}
          series={
            <FunnelSeries
              arc={
                <FunnelArc
                  colorScheme={["#A855F7"]}
                  gradient={null}
                  glow={{
                    blur: 50,
                    color: "#A855F7",
                  }}
                />
              }
              axis={
                <FunnelAxis
                  label={<FunnelAxisLabel className="opacity-0" />}
                  line={<FunnelAxisLine strokeColor="rgba(168,85,247,0.30)" />}
                />
              }
            />
          }
        />

        {/* Hover overlay : bandes verticales (funnel horizontal) */}
        <div className="absolute inset-x-4 top-6 bottom-6 flex flex-row">
          {data.map((d, i) => (
            <div
              key={`${i}-${d.key}`}
              className={`flex-1 transition-colors duration-200 ${
                hovered?.index === i
                  ? "bg-purple-500/[0.06] border-x border-purple-300/40"
                  : ""
              }`}
              onMouseMove={(e) =>
                setHovered({ index: i, x: e.clientX, y: e.clientY })
              }
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </div>
      </div>

      {/* Premium tooltip card */}
      {hovered && hoveredData && (
        <div
          className="fixed z-50 pointer-events-none rounded-xl border border-purple-200 bg-white/95 backdrop-blur-sm px-4 py-3 shadow-[0_12px_32px_-8px_rgba(91,20,197,0.35),0_2px_8px_-2px_rgba(0,0,0,0.08)]"
          style={{ left: hovered.x + 14, top: hovered.y + 14 }}
        >
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="h-1 w-1 rounded-full bg-purple-500" />
            <span className="text-[9px] uppercase tracking-[0.22em] text-purple-700 font-bold">
              Étape {hovered.index + 1}
            </span>
          </div>
          <div className="text-sm text-zinc-900 font-semibold max-w-[260px] leading-tight mb-2">
            {hoveredData.key.replace(/^\d+\.\s*/, "")}
          </div>
          <div className="flex items-baseline gap-1.5 mb-2">
            <span className="text-3xl font-mono font-bold text-zinc-900 tracking-tight">
              {hoveredData.data.toLocaleString("fr-FR")}
            </span>
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
              événements
            </span>
          </div>
          {(hoveredVsPrev !== null ||
            (hoveredVsFirst !== null && hovered.index > 0)) && (
            <div className="flex gap-4 pt-2 border-t border-zinc-100 text-[10px]">
              {hoveredVsPrev !== null && (
                <div>
                  <div className="uppercase tracking-wider text-zinc-400 mb-0.5">
                    vs précédent
                  </div>
                  <div className="font-mono text-purple-700 font-bold">
                    {hoveredVsPrev}%
                  </div>
                </div>
              )}
              {hoveredVsFirst !== null && hovered.index > 0 && (
                <div>
                  <div className="uppercase tracking-wider text-zinc-400 mb-0.5">
                    vs étape 1
                  </div>
                  <div className="font-mono text-purple-700 font-bold">
                    {hoveredVsFirst}%
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
