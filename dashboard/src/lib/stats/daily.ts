import { getSupabase, getSupabaseScoped } from "@/lib/supabase/service";
import { formatInTimeZone } from "date-fns-tz";

const TZ = "Europe/Paris";

export interface DailyPoint {
  day: string;
  count: number;
}

function dayKey(iso: string): string {
  return formatInTimeZone(new Date(iso), TZ, "yyyy-MM-dd");
}

/**
 * Returns the [from 00:00 Paris, to 23:59:59 Paris] window converted to UTC
 * ISO strings, suitable for >= and <= comparisons against `timestamptz`
 * columns.
 *
 * DST handling : we sample the offset at two different reference points
 * because spring-forward / fall-back days have a different offset at the
 * START vs the END of the local day.
 *   - fromUtc samples at T00:00:00Z : matches the early-morning offset of
 *     the local day (before any DST transition that happens at 02:00/03:00
 *     local time).
 *   - toUtc samples at T12:00:00Z : noon UTC is always already past the
 *     DST transition for that day in Paris, so the offset reflects the
 *     end-of-day state. Without this, autumn fall-back days would have
 *     their last 2 hours excluded from the window (issue caught in code
 *     review of Phase 7).
 */
function rangeBoundsUtc(from: string, to: string): { fromUtc: string; toUtc: string } {
  const fromOffset = formatInTimeZone(new Date(`${from}T00:00:00Z`), TZ, "XXX");
  const toOffset = formatInTimeZone(new Date(`${to}T12:00:00Z`), TZ, "XXX");
  return {
    fromUtc: `${from}T00:00:00${fromOffset}`,
    toUtc: `${to}T23:59:59.999${toOffset}`,
  };
}

async function paginateBucketed(
  query: (page: number, pageSize: number) => Promise<{ rows: { ts: string }[] | null; error: unknown }>,
  from: string,
  to: string
): Promise<DailyPoint[]> {
  const buckets = new Map<string, number>();
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { rows, error } = await query(offset, PAGE);
    if (error) throw error;
    if (!rows || rows.length === 0) break;
    for (const row of rows) {
      const k = dayKey(row.ts);
      buckets.set(k, (buckets.get(k) ?? 0) + 1);
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
    if (offset > 1_000_000) {
      throw new Error("paginateBucketed: > 1M rows, aborting");
    }
  }
  return fillRange(from, to, buckets);
}

export async function getCustomEventDaily(
  schoolSlug: string,
  eventNs: string,
  from: string,
  to: string
): Promise<DailyPoint[]> {
  const sb = getSupabaseScoped(schoolSlug);
  const { fromUtc, toUtc } = rangeBoundsUtc(from, to);
  return paginateBucketed(
    async (offset, pageSize) => {
      const { data, error } = await sb
        .from("mm_occurrences")
        .select("occurred_at")
        .eq("school_slug", schoolSlug)
        .eq("event_ns", eventNs)
        .gte("occurred_at", fromUtc)
        .lte("occurred_at", toUtc)
        .order("occurred_at")
        .range(offset, offset + pageSize - 1);
      return {
        rows: data?.map((d) => ({ ts: d.occurred_at as string })) ?? null,
        error,
      };
    },
    from,
    to
  );
}

export async function getClicksDaily(
  eventId: string,
  from: string,
  to: string
): Promise<DailyPoint[]> {
  const sb = getSupabase();
  const { fromUtc, toUtc } = rangeBoundsUtc(from, to);
  return paginateBucketed(
    async (offset, pageSize) => {
      const { data, error } = await sb
        .from("clicks")
        .select("clicked_at")
        .eq("event_id", eventId)
        .gte("clicked_at", fromUtc)
        .lte("clicked_at", toUtc)
        .order("clicked_at")
        .range(offset, offset + pageSize - 1);
      return {
        rows: data?.map((d) => ({ ts: d.clicked_at as string })) ?? null,
        error,
      };
    },
    from,
    to
  );
}

function fillRange(
  from: string,
  to: string,
  buckets: Map<string, number>
): DailyPoint[] {
  // Iterate using the Paris timezone day-by-day so we don't skip or
  // duplicate days at DST boundaries.
  const out: DailyPoint[] = [];
  const start = new Date(`${from}T12:00:00Z`); // noon UTC = always same day Paris
  const end = new Date(`${to}T12:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = formatInTimeZone(d, TZ, "yyyy-MM-dd");
    out.push({ day: k, count: buckets.get(k) ?? 0 });
  }
  return out;
}
