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

interface DailyPoint {
  day: string;
  count: number;
}

export function RedirectAccordion({
  redirect,
  from,
  to,
  showSchoolChip = false,
}: {
  redirect: {
    id: string;
    slug: string;
    name: string;
    school_slug: string;
    school_name: string;
    count: number;
  };
  from: string;
  to: string;
  showSchoolChip?: boolean;
}) {
  const [series, setSeries] = useState<DailyPoint[] | null>(null);
  const [opened, setOpened] = useState(false);
  const seriesToken = useRef(0);

  async function loadOnOpen() {
    if (opened) return;
    setOpened(true);
    const j = await fetch(
      `/api/stats/clicks/${redirect.id}/daily?from=${from}&to=${to}`
    ).then((r) => r.json());
    setSeries(j.series ?? []);
  }

  useEffect(() => {
    if (!opened) return;
    const sToken = ++seriesToken.current;
    setSeries(null);
    fetch(`/api/stats/clicks/${redirect.id}/daily?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((j) => {
        if (seriesToken.current === sToken) setSeries(j.series ?? []);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const total = (series ?? []).reduce((s, p) => s + p.count, 0);

  return (
    <AccordionItem value={redirect.id} className="border rounded bg-white">
      <AccordionTrigger
        onClick={loadOnOpen}
        className="px-4 hover:no-underline"
      >
        <div className="flex justify-between w-full pr-2 items-baseline gap-3">
          <div className="flex flex-col items-start min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              {showSchoolChip && (
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">
                  {redirect.school_name}
                </span>
              )}
              <span className="font-medium truncate">{redirect.name}</span>
            </div>
            <code className="text-xs text-zinc-400">/r/{redirect.slug}</code>
          </div>
          <span className="text-zinc-500 text-sm shrink-0">
            {redirect.count} clic{redirect.count !== 1 ? "s" : ""}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4">
        {!series ? (
          <p className="text-sm text-zinc-500">Chargement…</p>
        ) : series.length === 0 || total === 0 ? (
          <p className="text-sm text-zinc-500">Aucun clic sur la période.</p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={series}>
                <XAxis dataKey="day" fontSize={10} />
                <YAxis fontSize={10} />
                <Tooltip />
                <Bar dataKey="count" fill="#10b981" name="Clics" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
