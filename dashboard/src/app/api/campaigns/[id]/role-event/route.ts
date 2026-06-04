import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabase, getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";

/**
 * PATCH /api/campaigns/[id]/role-event
 *
 * Endpoint chirurgical pour modifier UNIQUEMENT l'event d'un rôle
 * (launch ou failed) d'une campagne sans devoir renvoyer la liste
 * complète des refs. Utilisé par les selects inline de la carte
 * « Synthèse coût Meta » dans le builder de campagne.
 *
 * Body :
 *   { role: "launch" | "failed",
 *     event_ns: string | null,           // null = clear (DELETE)
 *     event_school_slug?: string | null }
 *
 * Atomique : DELETE l'éventuelle row du rôle puis INSERT la nouvelle
 * (séquentiel non transactionnel, OK car les 2 opérations sont
 * commutatives ici — au pire on a juste un état « clear » transitoire).
 */
const Body = z.object({
  role: z.enum(["launch", "failed"]),
  event_ns: z.string().min(1).nullable(),
  event_school_slug: z.string().min(1).optional().nullable(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);
  const sbRaw = getSupabase();

  // Vérifie ownership / accès en édition (owner ou admin).
  const { data: campaign } = await sb
    .from("campaigns")
    .select("id, school_slug, created_by, is_shared")
    .eq("id", id)
    .maybeSingle();
  if (!campaign || campaign.school_slug !== schoolSlug)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const visible =
    campaign.created_by === user.userId || campaign.is_shared;
  if (!visible) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: meRow } = await sbRaw
    .from("users")
    .select("is_admin")
    .eq("id", user.userId)
    .maybeSingle();
  const isAdmin = !!meRow?.is_admin;
  if (!isAdmin && campaign.created_by !== user.userId)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // DELETE l'éventuelle row existante pour ce rôle. Idempotent : si pas
  // de row, no-op. L'index UNIQUE partiel (migration 012) bloquerait
  // un 2e INSERT donc le DELETE prélable est nécessaire avant tout
  // changement de l'event.
  const { error: delErr } = await sb
    .from("campaign_refs")
    .delete()
    .eq("campaign_id", id)
    .eq("role", parsed.data.role);
  if (delErr)
    return NextResponse.json({ error: delErr.message }, { status: 500 });

  // Si event_ns null, on s'arrête là (rôle cleared).
  if (parsed.data.event_ns === null) {
    return NextResponse.json({ ok: true, cleared: true });
  }

  // INSERT la nouvelle row avec une position à la fin (max + 1, ou 0
  // si pas de refs). La position n'a pas de sens fonctionnel pour
  // launch/failed (qui sont uniques) mais le schema l'exige.
  const { data: maxRow } = await sb
    .from("campaign_refs")
    .select("position")
    .eq("campaign_id", id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPos = (maxRow?.position ?? -1) + 1;

  const { error: insErr } = await sb.from("campaign_refs").insert({
    campaign_id: id,
    position: nextPos,
    step_type: "mm_event",
    event_ns: parsed.data.event_ns,
    redirect_event_id: null,
    event_school_slug: parsed.data.event_school_slug ?? null,
    role: parsed.data.role,
  });
  if (insErr)
    return NextResponse.json({ error: insErr.message }, { status: 500 });

  // Bump updated_at sur la campagne pour cohérence liste.
  await sb
    .from("campaigns")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true, cleared: false });
}
