import type { DatePreset } from "./types";

const PRESET_DAYS: Record<Exclude<DatePreset, "custom">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function resolveDateRange(input: {
  preset: DatePreset;
  from?: string | null;
  to?: string | null;
}): { from: string; to: string } {
  if (input.preset === "custom" && input.from && input.to) {
    return { from: input.from, to: input.to };
  }
  const days =
    input.preset === "custom" ? PRESET_DAYS["30d"] : PRESET_DAYS[input.preset];
  const today = new Date();
  const to = fmt(today);
  const fromDate = new Date(today);
  fromDate.setUTCDate(fromDate.getUTCDate() - (days - 1));
  return { from: fmt(fromDate), to };
}
