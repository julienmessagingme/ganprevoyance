import { NextResponse } from "next/server";
import { z } from "zod";
import { customAlphabet } from "nanoid";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

// Slug alphabet without ambiguous chars (no 0, O, 1, l, I).
const slugGen = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 8);

const Body = z.object({
  name: z.string().min(1).max(120),
  destinationUrl: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "must be http(s)"),
});

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);

  // Retry on slug collision (very rare with 8-char alphabet of 32 = 32^8 keyspace).
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = slugGen();
    const { data: ev, error: e1 } = await sb
      .from("redirect_events")
      .insert({
        school_slug: schoolSlug,
        slug,
        name: parsed.data.name,
        created_by: user.userId,
      })
      .select("id, slug")
      .single();

    if (e1) {
      // 23505 = unique_violation (slug collision) → retry
      if ((e1 as { code?: string }).code === "23505") continue;
      return NextResponse.json(
        { error: "db error", details: e1.message },
        { status: 500 }
      );
    }

    const { error: e2 } = await sb
      .from("redirect_versions")
      .insert({
        event_id: ev.id,
        destination_url: parsed.data.destinationUrl,
        version: 1,
      });
    if (e2) {
      return NextResponse.json(
        { error: "db error", details: e2.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, id: ev.id, slug: ev.slug });
  }
  return NextResponse.json({ error: "slug collision" }, { status: 500 });
}

export async function GET() {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);

  const { data: events, error } = await sb
    .from("redirect_events")
    .select("id, slug, name, created_at")
    .eq("school_slug", schoolSlug)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // For each event : fetch the active version + click count + last click.
  // N+1 acceptable for the foreseeable scale (a school has ~tens of events).
  const enriched = await Promise.all(
    (events ?? []).map(async (ev) => {
      const [verResult, countResult, lastClickResult] = await Promise.all([
        sb
          .from("redirect_versions")
          .select("id, destination_url, version, active_from")
          .eq("event_id", ev.id)
          .is("active_to", null)
          .maybeSingle(),
        sb
          .from("clicks")
          .select("*", { count: "exact", head: true })
          .eq("event_id", ev.id),
        sb
          .from("clicks")
          .select("clicked_at")
          .eq("event_id", ev.id)
          .order("clicked_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      return {
        id: ev.id,
        slug: ev.slug,
        name: ev.name,
        createdAt: ev.created_at,
        currentVersion: verResult.data,
        clickCount: countResult.count ?? 0,
        lastClickAt: lastClickResult.data?.clicked_at ?? null,
      };
    })
  );
  return NextResponse.json({ events: enriched });
}
