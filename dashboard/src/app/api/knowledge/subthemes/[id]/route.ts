import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

const PatchBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  themeId: z.string().uuid().nullable().optional(),
});

/**
 * Verifies the subtheme belongs to the given school. The school slug is
 * passed in (rather than re-read from the cookie inside) so the caller
 * can ensure the same value is used across multiple ownership checks in
 * a single request — avoids a TOCTOU window if the cookie changed
 * mid-request.
 */
async function findOwnedSubtheme(
  id: string,
  schoolSlug: string
): Promise<{ id: string } | null> {
  const sb = getSupabaseScoped(schoolSlug);
  const { data } = await sb
    .from("knowledge_subthemes")
    .select("id, school_slug")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.school_slug !== schoolSlug) return null;
  return { id: data.id };
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
  if (!parsed.success || (parsed.data.name === undefined && parsed.data.themeId === undefined)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Read the school slug ONCE at the top : both the subtheme ownership
  // check and the (optional) theme ownership check must run against the
  // same school to be authoritative. Calling getCurrentSchoolSlugChecked() twice
  // would open a TOCTOU window if the cookie flips between the two calls.
  const schoolSlug = await getCurrentSchoolSlugChecked();

  const owned = await findOwnedSubtheme(id, schoolSlug);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const sb = getSupabaseScoped(schoolSlug);

  // If themeId is being set, validate it belongs to the same school.
  if (parsed.data.themeId) {
    const { data: theme } = await sb
      .from("knowledge_themes")
      .select("school_slug")
      .eq("id", parsed.data.themeId)
      .maybeSingle();
    if (!theme || theme.school_slug !== schoolSlug) {
      return NextResponse.json(
        { error: "invalid themeId" },
        { status: 400 }
      );
    }
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.themeId !== undefined) update.theme_id = parsed.data.themeId;

  const { error } = await sb
    .from("knowledge_subthemes")
    .update(update)
    .eq("id", id);

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "duplicate", message: "Ce nom de sous-thème existe déjà." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
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
  const schoolSlug = await getCurrentSchoolSlugChecked();
  const owned = await findOwnedSubtheme(id, schoolSlug);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  // FK on knowledge_items.subtheme_id is ON DELETE SET NULL — items lose
  // the subtheme link but stay alive.
  const { error } = await getSupabaseScoped(schoolSlug)
    .from("knowledge_subthemes")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
