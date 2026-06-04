import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabase, getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

const PostBody = z.object({
  name: z.string().trim().min(1).max(200),
  /** Type de viz à la création. Défaut 'funnel' pour compat avec les
   *  anciens clients qui n'envoient pas ce champ. */
  type: z.enum(["funnel", "pie"]).optional(),
  /** Partagé avec l'école (visible par tous les users de l'école).
   *  Défaut false (privé). Ne s'applique qu'aux tableaux libres ;
   *  pour un tableau de campagne, la visibilité vient de la campagne. */
  is_shared: z.boolean().optional(),
});

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);
  const sbRaw = getSupabase();
  // Visibilité : mes tableaux + ceux partagés par d'autres pour cette
  // école. Exclut les tableaux liés à une campagne (édités via /campaigns).
  const { data, error } = await sb
    .from("dashboards")
    .select(
      "id, school_slug, created_by, name, type, date_preset, date_from, date_to, created_at, updated_at, campaign_id, is_shared"
    )
    .eq("school_slug", schoolSlug)
    .is("campaign_id", null)
    .or(`created_by.eq.${user.userId},is_shared.eq.true`)
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Annote chaque dashboard avec can_edit (owner ou admin).
  const { data: meRow } = await sbRaw
    .from("users")
    .select("is_admin")
    .eq("id", user.userId)
    .maybeSingle();
  const isAdmin = !!meRow?.is_admin;
  const dashboards = (data ?? []).map((d) => ({
    ...d,
    can_edit: isAdmin || d.created_by === user.userId,
  }));

  return NextResponse.json({ dashboards });
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
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
    .from("dashboards")
    .insert({
      school_slug: schoolSlug,
      created_by: user.userId,
      name: parsed.data.name,
      type: parsed.data.type ?? "funnel",
      is_shared: parsed.data.is_shared ?? false,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: data.id });
}
