import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

const PostBody = z.object({
  name: z.string().trim().min(1).max(120),
  themeId: z.string().uuid().nullable().optional(),
});

export async function GET(req: Request) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const url = new URL(req.url);
  const themeId = url.searchParams.get("themeId");

  const sb = getSupabaseScoped(schoolSlug);
  let q = sb
    .from("knowledge_subthemes")
    .select("id, name, theme_id, created_at")
    .eq("school_slug", schoolSlug)
    .order("name");
  if (themeId) {
    q = q.eq("theme_id", themeId);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ subthemes: data ?? [] });
}

export async function POST(req: Request) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);

  // If themeId provided, verify it belongs to the current school. Otherwise
  // a malicious client could attach a subtheme to another school's theme.
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

  const { data, error } = await sb
    .from("knowledge_subthemes")
    .insert({
      school_slug: schoolSlug,
      name: parsed.data.name,
      theme_id: parsed.data.themeId ?? null,
    })
    .select("id, name, theme_id, created_at")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "duplicate", message: "Ce sous-thème existe déjà." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ subtheme: data });
}
