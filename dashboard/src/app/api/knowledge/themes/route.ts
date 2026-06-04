import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

const PostBody = z.object({
  name: z.string().trim().min(1).max(120),
});

export async function GET() {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);
  const { data, error } = await sb
    .from("knowledge_themes")
    .select("id, name, created_at")
    .eq("school_slug", schoolSlug)
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ themes: data ?? [] });
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
  const { data, error } = await sb
    .from("knowledge_themes")
    .insert({ school_slug: schoolSlug, name: parsed.data.name })
    .select("id, name, created_at")
    .single();

  if (error) {
    // 23505 = unique_violation on (school_slug, name)
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "duplicate", message: "Ce thème existe déjà." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ theme: data });
}
