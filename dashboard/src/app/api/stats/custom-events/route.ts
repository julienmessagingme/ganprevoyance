import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { getSchoolBySlug } from "@/lib/schools";
import { formatInTimeZone } from "date-fns-tz";
import { groupMetaCostsByCountry } from "@/lib/meta-pricing";
import type { MetaCostBreakdownItem } from "@/lib/dashboards/types";

export const runtime = "nodejs";

const TZ = "Europe/Paris";
const Q = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(req: Request) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const url = new URL(req.url);
  const parsed = Q.safeParse({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "missing or bad from/to" }, { status: 400 });
  }

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);

  const { data: events, error } = await sb
    .from("mm_events")
    .select("school_slug, event_ns, name, description, text_label")
    .eq("school_slug", schoolSlug)
    .order("name");
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Bornes UTC DST-aware. Cf. lib/stats/daily.ts pour la logique.
  const fromOffset = formatInTimeZone(
    new Date(`${parsed.data.from}T00:00:00Z`),
    TZ,
    "XXX"
  );
  const toOffset = formatInTimeZone(
    new Date(`${parsed.data.to}T12:00:00Z`),
    TZ,
    "XXX"
  );
  const fromUtc = `${parsed.data.from}T00:00:00${fromOffset}`;
  const toUtc = `${parsed.data.to}T23:59:59.999${toOffset}`;

  const counts = await Promise.all(
    (events ?? []).map(async (ev) => {
      const isPhoneCarrier = ((ev as { text_label?: string | null }).text_label ?? "").trim().length > 0;
      const school = getSchoolBySlug(ev.school_slug);
      const base = {
        school_slug: ev.school_slug,
        school_name: school?.name ?? ev.school_slug,
        event_ns: ev.event_ns,
        name: ev.name,
        description: ev.description,
      };

      if (isPhoneCarrier) {
        // Event porteur (text_label non vide) → on récupère les text_value
        // pour calculer count + coût Meta + breakdown par pays en une seule
        // requête. Limite 10k (au-delà sous-évalué — cf. todo perf).
        const { data: occRows } = await sb
          .from("mm_occurrences")
          .select("text_value")
          .eq("school_slug", ev.school_slug)
          .eq("event_ns", ev.event_ns)
          .gte("occurred_at", fromUtc)
          .lte("occurred_at", toUtc)
          .limit(10000);
        const rows = (occRows ?? []) as { text_value: string | null }[];
        const phones = rows
          .map((r) => r.text_value ?? "")
          .filter((p) => p.length > 0);
        const breakdown = groupMetaCostsByCountry(phones);
        const metaBreakdown: MetaCostBreakdownItem[] = breakdown.map((b) => ({
          iso: b.iso,
          name: b.name,
          count: b.count,
          rate_eur: b.rateEur,
          total_eur: b.totalEur,
        }));
        const metaCostEur = metaBreakdown.reduce(
          (s, b) => s + b.total_eur,
          0
        );
        return {
          ...base,
          count: rows.length,
          meta_cost_eur: metaCostEur,
          meta_breakdown: metaBreakdown,
        };
      }

      const { count } = await sb
        .from("mm_occurrences")
        .select("*", { count: "exact", head: true })
        .eq("school_slug", ev.school_slug)
        .eq("event_ns", ev.event_ns)
        .gte("occurred_at", fromUtc)
        .lte("occurred_at", toUtc);
      return { ...base, count: count ?? 0 };
    })
  );

  const { data: syncs } = await sb
    .from("mm_sync_state")
    .select("school_slug, event_ns, last_run_at, last_run_status, last_run_error")
    .eq("school_slug", schoolSlug);

  return NextResponse.json({ events: counts, syncs: syncs ?? [] });
}
