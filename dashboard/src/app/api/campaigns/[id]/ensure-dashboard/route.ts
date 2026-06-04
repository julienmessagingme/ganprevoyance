import { NextResponse } from "next/server";
import { getSupabase, getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

/**
 * POST /api/campaigns/[id]/ensure-dashboard
 *
 * Crée le dashboard 1:1 lié à la campagne s'il n'existe pas encore.
 * Cas d'usage : campagnes créées AVANT la migration 010 (Phase 21) qui
 * n'ont pas de dashboard associé. Idempotent : renvoie l'id existant
 * si la campagne en a déjà un.
 *
 * Auth : owner de la campagne ou admin (cf. `loadAccessible`/can_edit
 * de la route /[id]). On duplique la logique ici pour éviter un import
 * cyclique ; à factoriser si on en a besoin ailleurs.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);
  const sbRaw = getSupabase();

  const { data: campaign } = await sb
    .from("campaigns")
    .select("id, school_slug, created_by, name, is_shared")
    .eq("id", id)
    .maybeSingle();
  if (!campaign || campaign.school_slug !== schoolSlug)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  // Visible si owner ou partagée ; éditable (= peut créer le dashboard)
  // uniquement si owner ou admin.
  const visible = campaign.created_by === user.userId || campaign.is_shared;
  if (!visible) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: meRow } = await sbRaw
    .from("users")
    .select("is_admin")
    .eq("id", user.userId)
    .maybeSingle();
  const isAdmin = !!meRow?.is_admin;
  const canEdit = isAdmin || campaign.created_by === user.userId;
  if (!canEdit)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Idempotent : si un dashboard est déjà lié, on le retourne tel quel.
  const { data: existing } = await sb
    .from("dashboards")
    .select("id")
    .eq("campaign_id", id)
    .maybeSingle();
  if (existing)
    return NextResponse.json({ dashboard_id: existing.id, created: false });

  // Création. Le dashboard hérite du nom de la campagne (synchronisé au
  // moment de la création, libre de diverger après — pas de propagation
  // automatique du rename de la campagne sur le dashboard, et inversement).
  // Type par défaut 'funnel' (les campagnes pré-Phase-22 ne portent pas de
  // type ; pour les nouvelles, POST /api/campaigns crée déjà le dashboard
  // avec le bon type, donc ce ensure-dashboard ne s'applique qu'aux
  // campagnes legacy).
  const { data: created, error } = await sb
    .from("dashboards")
    .insert({
      school_slug: schoolSlug,
      created_by: campaign.created_by,
      name: campaign.name,
      campaign_id: id,
      type: "funnel",
    })
    .select("id")
    .single();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ dashboard_id: created.id, created: true });
}
