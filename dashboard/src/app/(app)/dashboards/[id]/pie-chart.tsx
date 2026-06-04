"use client";

import {
  PieChart as RPieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { ComputedStep } from "@/lib/dashboards/types";
import { compactStepLabel } from "@/lib/dashboards/types";

// Palette dérivée du funnel mais étalée pour bien distinguer N parts.
// 8 couleurs suffisent en pratique ; au-delà, recharts cycle.
const PIE_COLORS = [
  "#27272a", // zinc-800
  "#7c3aed", // violet-600
  "#0284c7", // sky-600
  "#16a34a", // green-600
  "#ea580c", // orange-600
  "#dc2626", // red-600
  "#a16207", // yellow-700
  "#0891b2", // cyan-600
];

interface PieDatum {
  label: string;
  fullLabel: string;
  count: number;
  available: boolean;
}

export function PieChartViz({ steps }: { steps: ComputedStep[] }) {
  if (steps.length === 0) return null;

  // Filtre les parts indisponibles ET les volumes 0 (recharts les rendrait
  // comme des slivers indistinguables qui parasitent la légende).
  const data: PieDatum[] = steps
    .map((s, i) => {
      const compact = compactStepLabel(s);
      return {
        label: `${i + 1}. ${compact}`,
        fullLabel: compact,
        count: s.count,
        available: s.available,
      };
    })
    .filter((d) => d.available && d.count > 0);

  if (data.length === 0) {
    return (
      <p className="text-zinc-500 text-sm py-8 text-center">
        Aucune donnée à afficher (toutes les parts sont vides).
      </p>
    );
  }

  const total = data.reduce((acc, d) => acc + d.count, 0);

  return (
    <div className="w-full" style={{ height: 360 }}>
      <ResponsiveContainer width="100%" height="100%">
        <RPieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="label"
            cx="40%"
            cy="50%"
            outerRadius={120}
            innerRadius={0}
            paddingAngle={1}
            label={({ percent }) =>
              percent !== undefined && percent > 0.05
                ? `${(percent * 100).toFixed(1)}%`
                : ""
            }
            labelLine={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v: unknown, _name, payload) => {
              const count = Number(v);
              const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0";
              return [
                `${count.toLocaleString("fr-FR")} (${pct} %)`,
                (payload?.payload as PieDatum | undefined)?.fullLabel ??
                  "Volume",
              ];
            }}
          />
          <Legend
            layout="vertical"
            align="right"
            verticalAlign="middle"
            wrapperStyle={{ fontSize: 12, lineHeight: "1.4" }}
          />
        </RPieChart>
      </ResponsiveContainer>
    </div>
  );
}
