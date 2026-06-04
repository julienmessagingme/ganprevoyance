import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { invalidateSlugCache } from "@/lib/redirect/lookup";

export const runtime = "nodejs";

const Body = z.object({
  destinationUrl: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "must be http(s)"),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);

  const { data: ev } = await sb
    .from("redirect_events")
    .select("id, slug, school_slug")
    .eq("id", id)
    .maybeSingle();
  if (!ev || ev.school_slug !== schoolSlug) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Close the currently active version. The unique partial index on
  // redirect_versions(event_id) WHERE active_to IS NULL guarantees only one
  // active version exists at any time; we MUST close it before inserting the
  // next one or the insert will violate that constraint.
  const now = new Date().toISOString();
  const { error: e1 } = await sb
    .from("redirect_versions")
    .update({ active_to: now })
    .eq("event_id", id)
    .is("active_to", null);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  const { data: maxRow } = await sb
    .from("redirect_versions")
    .select("version")
    .eq("event_id", id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (maxRow?.version ?? 0) + 1;

  const { error: e2 } = await sb
    .from("redirect_versions")
    .insert({
      event_id: id,
      destination_url: parsed.data.destinationUrl,
      version: nextVersion,
    });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  // Critical: flush the lookup cache so future hits of /r/<slug> see the new
  // destination immediately instead of serving the old one for up to 60s.
  invalidateSlugCache(ev.slug);

  return NextResponse.json({ ok: true, version: nextVersion });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);

  // Verify ownership.
  const { data: ev } = await sb
    .from("redirect_events")
    .select("id, school_slug")
    .eq("id", id)
    .maybeSingle();
  if (!ev || ev.school_slug !== schoolSlug) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: versions, error } = await sb
    .from("redirect_versions")
    .select("id, destination_url, version, active_from, active_to")
    .eq("event_id", id)
    .order("version", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // For each version, count clicks.
  const enriched = await Promise.all(
    (versions ?? []).map(async (v) => {
      const { count } = await sb
        .from("clicks")
        .select("*", { count: "exact", head: true })
        .eq("version_id", v.id);
      return { ...v, clickCount: count ?? 0 };
    })
  );

  return NextResponse.json({ versions: enriched });
}
