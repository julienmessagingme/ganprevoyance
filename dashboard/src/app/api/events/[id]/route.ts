import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { invalidateSlugCache } from "@/lib/redirect/lookup";

export const runtime = "nodejs";

const PatchBody = z.object({ name: z.string().min(1).max(120) });

async function findOwned(id: string): Promise<{ slug: string } | null> {
  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);
  // .select() est auto-filtré sur school_slug par le wrapper Proxy ;
  // un id d'une autre école renverra simplement data=null.
  const { data } = await sb
    .from("redirect_events")
    .select("slug, school_slug")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.school_slug !== schoolSlug) return null;
  return { slug: data.slug };
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const owned = await findOwned(id);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const { error } = await getSupabaseScoped(schoolSlug)
    .from("redirect_events")
    .update({ name: parsed.data.name })
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const owned = await findOwned(id);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const { error } = await getSupabaseScoped(schoolSlug)
    .from("redirect_events")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  // The slug now points to an archived event; flush cache so /r/<slug>
  // returns 404 immediately instead of serving from a 60s stale entry.
  invalidateSlugCache(owned.slug);
  return NextResponse.json({ ok: true });
}
