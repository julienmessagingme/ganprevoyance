import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

const PatchBody = z.object({
  name: z.string().trim().min(1).max(120),
});

/**
 * Verifies the theme belongs to the given school. The slug is passed in
 * (rather than re-read from the cookie) so the caller can ensure a single
 * snapshot of the current school is used for the whole request, avoiding
 * a TOCTOU window if multiple ownership checks happen in sequence.
 */
async function findOwnedTheme(
  id: string,
  schoolSlug: string
): Promise<{ id: string } | null> {
  const sb = getSupabaseScoped(schoolSlug);
  const { data } = await sb
    .from("knowledge_themes")
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
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const owned = await findOwnedTheme(id, schoolSlug);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error } = await getSupabaseScoped(schoolSlug)
    .from("knowledge_themes")
    .update({ name: parsed.data.name })
    .eq("id", id);

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "duplicate", message: "Ce nom de thème existe déjà." },
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
  const owned = await findOwnedTheme(id, schoolSlug);
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Cascade : the FK on knowledge_subthemes.theme_id is ON DELETE CASCADE,
  // so subthemes go away with the theme. knowledge_items.theme_id is ON
  // DELETE SET NULL, so items keep but lose their theme link.
  const { error } = await getSupabaseScoped(schoolSlug)
    .from("knowledge_themes")
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
