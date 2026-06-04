import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabase, getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import type {
  CampaignRef,
  CampaignWithRefs,
} from "@/lib/campaigns/types";

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
    role: z.literal("body").optional(),
  }),
]);

const PatchBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    is_shared: z.boolean().optional(),
    refs: z.array(RefSchema).max(200).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "empty patch");

/** Charge la campagne + flags d'accès, en validant l'école courante.
 *  - `accessible`  : `created_by = me` OR `is_shared = true`
 *  - `can_edit`    : `created_by = me` OR admin
 *  Renvoie `null` si la campagne n'existe pas ou n'est pas accessible. */
async function loadAccessible(
  id: string,
  userId: string
): Promise<{
  row: {
    id: string;
    school_slug: string;
    created_by: string;
    name: string;
    is_shared: boolean;
    created_at: string;
    updated_at: string;
  };
  can_edit: boolean;
} | null> {
  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);
  const sbRaw = getSupabase();
  const { data } = await sb
    .from("campaigns")
    .select(
      "id, school_slug, created_by, name, is_shared, created_at, updated_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  if (data.school_slug !== schoolSlug) return null;

  const visible = data.created_by === userId || data.is_shared;
  if (!visible) return null;

  const { data: meRow } = await sbRaw
    .from("users")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  const isAdmin = !!meRow?.is_admin;

  return {
    row: data,
    can_edit: isAdmin || data.created_by === userId,
  };
}

export async function GET(
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
  const loaded = await loadAccessible(id, user.userId);
  if (!loaded) return NextResponse.json({ error: "not found" }, { status: 404 });

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);
  const [refsRes, dashRes] = await Promise.all([
    sb
      .from("campaign_refs")
      .select(
        "id, position, step_type, event_ns, redirect_event_id, event_school_slug, role"
      )
      .eq("campaign_id", id)
      .order("position", { ascending: true }),
    // Résolution du dashboard 1:1 lié (peut être absent pour les campagnes
    // créées avant la Phase 21 — auquel cas la page front en créera un).
    sb
      .from("dashboards")
      .select("id")
      .eq("campaign_id", id)
      .maybeSingle(),
  ]);
  if (refsRes.error)
    return NextResponse.json({ error: refsRes.error.message }, { status: 500 });

  const refs: CampaignRef[] = (refsRes.data ?? []).map((r) => ({
    id: r.id,
    position: r.position,
    step_type: r.step_type,
    event_ns: r.event_ns,
    redirect_event_id: r.redirect_event_id,
    event_school_slug: r.event_school_slug ?? null,
    role: (r.role ?? "body") as CampaignRef["role"],
  }));

  const campaign: CampaignWithRefs = {
    ...loaded.row,
    can_edit: loaded.can_edit,
    refs,
    dashboard_id: dashRes.data?.id ?? null,
  };
  return NextResponse.json({ campaign });
}

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
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const loaded = await loadAccessible(id, user.userId);
  if (!loaded) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!loaded.can_edit)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);
  const fields: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.name !== undefined) fields.name = parsed.data.name;
  if (parsed.data.is_shared !== undefined)
    fields.is_shared = parsed.data.is_shared;

  // Mise à jour de campaigns : on update updated_at dès que l'utilisateur
  // a touché à quelque chose (incluant les refs), pour que la card
  // « modifié le X » et le tri liste reflètent la réalité.
  const hasScalarChange = Object.keys(fields).length > 1;
  const hasRefsChange = parsed.data.refs !== undefined;
  if (hasScalarChange || hasRefsChange) {
    const { error } = await sb.from("campaigns").update(fields).eq("id", id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (parsed.data.refs !== undefined) {
    // Replace strategy : DELETE all + INSERT new. Non transactionnel mais
    // sans conséquence — si l'INSERT crash, la campagne se retrouve vide,
    // l'utilisateur re-sauve. Pas de side-effect calculé derrière (≠ dashboards).
    const { error: delErr } = await sb
      .from("campaign_refs")
      .delete()
      .eq("campaign_id", id);
    if (delErr)
      return NextResponse.json({ error: delErr.message }, { status: 500 });

    if (parsed.data.refs.length > 0) {
      const rows = parsed.data.refs.map((r, i) => ({
        campaign_id: id,
        position: i,
        step_type: r.step_type,
        event_ns: r.step_type === "mm_event" ? r.event_ns : null,
        redirect_event_id:
          r.step_type === "url_click" ? r.redirect_event_id : null,
        event_school_slug:
          r.step_type === "mm_event" ? r.event_school_slug ?? null : null,
        role: r.role ?? "body",
      }));
      const { error: insErr } = await sb.from("campaign_refs").insert(rows);
      if (insErr)
        return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
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
  const loaded = await loadAccessible(id, user.userId);
  if (!loaded) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!loaded.can_edit)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const { error } = await getSupabaseScoped(schoolSlug)
    .from("campaigns")
    .delete()
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
