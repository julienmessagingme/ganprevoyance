import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { getSchoolBySlug } from "@/lib/schools";
import { formatInTimeZone } from "date-fns-tz";

export const runtime = "nodejs";

const TZ = "Europe/Paris";
const Q = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * GET /api/stats/redirects?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Liste les URLs trackées (non archivées) avec leur nombre de clics sur
 * la période, pour l'école courante.
 */
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
    .from("redirect_events")
    .select("id, slug, name, school_slug")
    .is("archived_at", null)
    .eq("school_slug", schoolSlug)
    .order("name");
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Bornes UTC DST-aware (cf. /api/stats/custom-events).
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
      const { count } = await sb
        .from("clicks")
        .select("*", { count: "exact", head: true })
        .eq("event_id", ev.id)
        .gte("clicked_at", fromUtc)
        .lte("clicked_at", toUtc);
      const school = getSchoolBySlug(ev.school_slug);
      return {
        id: ev.id,
        slug: ev.slug,
        name: ev.name,
        school_slug: ev.school_slug,
        school_name: school?.name ?? ev.school_slug,
        count: count ?? 0,
      };
    })
  );

  return NextResponse.json({ redirects: counts });
}
