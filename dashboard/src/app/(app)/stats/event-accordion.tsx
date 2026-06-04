"use client";

import { useEffect, useRef, useState } from "react";
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { MetaCostButton } from "@/components/meta-cost-breakdown";
import type { MetaCostBreakdownItem } from "@/lib/dashboards/types";

interface DailyPoint {
  day: string;
  count: number;
}

export function EventAccordion({
  ev,
  from,
  to,
  showSchoolChip = false,
}: {
  ev: {
    school_slug: string;
    school_name: string;
    event_ns: string;
    name: string;
    count: number;
    meta_cost_eur?: number;
    meta_breakdown?: MetaCostBreakdownItem[];
  };
  from: string;
  to: string;
  /** Affiche un chip avec le nom de l'école devant le nom de l'event. */
  showSchoolChip?: boolean;
}) {
  const [series, setSeries] = useState<DailyPoint[] | null>(null);
  const [opened, setOpened] = useState(false);
  const seriesToken = useRef(0);

  function dailyUrl() {
    const params = new URLSearchParams({ from, to });
    if (showSchoolChip) params.set("school", ev.school_slug);
    return `/api/stats/custom-events/${encodeURIComponent(
      ev.event_ns
    )}/daily?${params.toString()}`;
  }

  async function loadOnOpen() {
    if (opened) return;
    setOpened(true);
    const j = await fetch(dailyUrl()).then((r) => r.json());
    setSeries(j.series ?? []);
  }

  useEffect(() => {
    if (!opened) return;
    const sToken = ++seriesToken.current;
    setSeries(null);
    fetch(dailyUrl())
      .then((r) => r.json())
      .then((j) => {
        if (seriesToken.current === sToken) setSeries(j.series ?? []);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const totalOcc = (series ?? []).reduce((s, p) => s + p.count, 0);

  return (
    <AccordionItem
      value={`${ev.school_slug}:${ev.event_ns}`}
      className="border rounded bg-white"
    >
      <AccordionTrigger
        onClick={loadOnOpen}
        className="px-4 hover:no-underline"
      >
        <div className="flex justify-between w-full pr-2 items-center gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {showSchoolChip && (
              <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">
                {ev.school_name}
              </span>
            )}
            <span className="font-medium truncate">{ev.name}</span>
          </div>
          <div className="flex items-center gap-3 shrink-0 text-sm">
            <span className="text-zinc-500">
              {ev.count} occurrence{ev.count !== 1 ? "s" : ""}
            </span>
            {ev.meta_cost_eur != null && ev.meta_cost_eur > 0 && (
              // Stop propagation pour que le clic ouvre la modale plutôt
              // que de toggle l'accordéon. Le bouton lui-même gère son
              // état (ne déclenche pas onClick du parent grâce au stop).
              <span onClick={(e) => e.stopPropagation()}>
                <MetaCostButton
                  amountEur={ev.meta_cost_eur}
                  breakdown={ev.meta_breakdown}
                  title={`Coût Meta — ${ev.name}`}
                />
              </span>
            )}
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4">
        {!series ? (
          <p className="text-sm text-zinc-500">Chargement…</p>
        ) : series.length === 0 || totalOcc === 0 ? (
          <p className="text-sm text-zinc-500">
            Aucune occurrence sur la période.
          </p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={series}>
                <XAxis dataKey="day" fontSize={10} />
                <YAxis fontSize={10} />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" name="Occurrences" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
