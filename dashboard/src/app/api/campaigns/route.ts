import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabase, getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import type { CampaignListItem } from "@/lib/campaigns/types";

export const runtime = "nodejs";

const RefSchema = z.discriminatedUnion("step_type", [
  z.object({
    step_type: z.literal("mm_event"),
    event_ns: z.string().min(1),
    event_school_slug: z.string().min(1).optional().nullable(),
    role: z.enum(["launch", "body", "failed"]).optional(),
  }),
  z.object({
    step_type: z.literal("url_click"),
    redirect_event_id: z.string().uuid(),
    // url_click ne peut pas être launch ni failed (ces 2 rôles sont des
    // events MM avec leurs propres compteurs/text_value). On accepte donc
    // uniquement 'body' (ou vide → défaut body).
    role: z.literal("body").optional(),
  }),
]);

const PostBody = z.object({
  name: z.string().trim().min(1).max(200),
  is_shared: z.boolean().optional(),
  refs: z.array(RefSchema).max(200).optional(),
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

  // Accessibles = mes campagnes + celles partagées par d'autres dans la
  // même école. PostgREST `or()` accepte une liste séparée par virgule.
  const { data, error } = await sb
    .from("campaigns")
    .select(
      "id, school_slug, created_by, name, is_shared, created_at, updated_at"
    )
    .eq("school_slug", schoolSlug)
    .or(`created_by.eq.${user.userId},is_shared.eq.true`)
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // can_edit : owner ou admin. On lit is_admin une fois pour annoter chaque
  // ligne (pas d'admin → can_edit = created_by === me uniquement).
  const { data: meRow } = await sbRaw
    .from("users")
    .select("is_admin")
    .eq("id", user.userId)
    .maybeSingle();
  const isAdmin = !!meRow?.is_admin;

  const campaigns: CampaignListItem[] = (data ?? []).map((c) => ({
    ...(c as CampaignListItem),
    can_edit: isAdmin || c.created_by === user.userId,
  }));
  return NextResponse.json({ campaigns });
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
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);
  const { data, error } = await sb
    .from("campaigns")
    .insert({
      school_slug: schoolSlug,
      created_by: user.userId,
      name: parsed.data.name,
      is_shared: parsed.data.is_shared ?? false,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Crée immédiatement le dashboard 1:1 lié (Phase 21). Si l'INSERT échoue,
  // on rollback en supprimant la campagne pour ne pas laisser d'orphelin.
  // L'ON DELETE CASCADE sur `dashboards.campaign_id` (migration 010) garantit
  // que toute suppression future de la campagne emportera son dashboard.
  // Le dashboard d'une campagne est toujours créé en 'funnel'. Le pie
  // chart est réservé aux tableaux libres dans Mes tableaux (décision
  // produit pour garder l'usage campagne focalisé sur la conversion).
  const { data: dashData, error: dashErr } = await sb
    .from("dashboards")
    .insert({
      school_slug: schoolSlug,
      created_by: user.userId,
      name: parsed.data.name,
      campaign_id: data.id,
      type: "funnel",
    })
    .select("id")
    .single();
  if (dashErr) {
    await sb.from("campaigns").delete().eq("id", data.id);
    return NextResponse.json(
      { error: `dashboard create: ${dashErr.message}` },
      { status: 500 }
    );
  }

  // Refs optionnelles à la création. Si le INSERT échoue, on a une campagne
  // sans briques — l'utilisateur peut re-sauver via PATCH. Volontairement
  // non atomique (le module campagne n'a pas de side-effect calculé,
  // contrairement à dashboards/replace_dashboard_steps).
  if (parsed.data.refs && parsed.data.refs.length > 0) {
    const rows = parsed.data.refs.map((r, i) => ({
      campaign_id: data.id,
      position: i,
      step_type: r.step_type,
      event_ns: r.step_type === "mm_event" ? r.event_ns : null,
      redirect_event_id:
        r.step_type === "url_click" ? r.redirect_event_id : null,
      event_school_slug:
        r.step_type === "mm_event" ? r.event_school_slug ?? null : null,
      role: r.role ?? "body",
    }));
    const { error: refsErr } = await sb.from("campaign_refs").insert(rows);
    if (refsErr) {
      return NextResponse.json({ error: refsErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ id: data.id, dashboard_id: dashData.id });
}
