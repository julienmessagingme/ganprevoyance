import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabase, getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import type {
  DashboardWithSteps,
  DashboardStep,
  StepRef,
} from "@/lib/dashboards/types";

export const runtime = "nodejs";

const RefSchema = z.discriminatedUnion("step_type", [
  z.object({
    step_type: z.literal("mm_event"),
    event_ns: z.string().min(1),
    /** Legacy multi-école (event_ns non globalement unique en théorie).
     *  Ignoré en mode école-précise (cas single-school Gan Prévoyance). */
    event_school_slug: z.string().min(1).optional().nullable(),
  }),
  z.object({
    step_type: z.literal("url_click"),
    redirect_event_id: z.string().uuid(),
  }),
]);

const StepSchema = z.object({
  label: z.string().trim().max(200).nullable().optional(),
  refs: z.array(RefSchema).min(1).max(20),
});

const PatchBody = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    date_preset: z.enum(["7d", "30d", "90d", "custom"]).optional(),
    date_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    date_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    steps: z.array(StepSchema).max(50).optional(),
    is_shared: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "empty patch");

/**
 * Charge le dashboard et calcule visible + can_edit.
 *   - visible  : owner OR is_shared
 *   - can_edit : owner OR admin
 * Renvoie null si pas dans la même école que le scope courant ou pas
 * visible. */
async function loadAccessible(
  id: string,
  userId: string
): Promise<{
  id: string;
  created_by: string;
  is_shared: boolean;
  can_edit: boolean;
} | null> {
  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);
  const sbRaw = getSupabase();
  const { data } = await sb
    .from("dashboards")
    .select("id, created_by, school_slug, is_shared")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  if (data.school_slug !== schoolSlug) return null;
  const visible = data.created_by === userId || data.is_shared === true;
  if (!visible) return null;

  const { data: meRow } = await sbRaw
    .from("users")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  const isAdmin = !!meRow?.is_admin;
  return {
    id: data.id,
    created_by: data.created_by,
    is_shared: data.is_shared,
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
  const access = await loadAccessible(id, user.userId);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);
  const [dashRes, stepsRes] = await Promise.all([
    sb
      .from("dashboards")
      .select(
        "id, school_slug, created_by, name, type, date_preset, date_from, date_to, created_at, updated_at, campaign_id, is_shared"
      )
      .eq("id", id)
      .single(),
    sb
      .from("dashboard_steps")
      .select("id, position, label")
      .eq("dashboard_id", id)
      .order("position", { ascending: true }),
  ]);
  if (dashRes.error)
    return NextResponse.json({ error: dashRes.error.message }, { status: 500 });
  if (stepsRes.error)
    return NextResponse.json({ error: stepsRes.error.message }, { status: 500 });

  const stepRows = (stepsRes.data ?? []) as Array<{
    id: string;
    position: number;
    label: string | null;
  }>;
  const stepIds = stepRows.map((s) => s.id);

  let refs: StepRef[] = [];
  if (stepIds.length > 0) {
    const { data: refsData, error: refsErr } = await sb
      .from("dashboard_step_refs")
      .select(
        "id, step_id, ref_position, step_type, event_ns, redirect_event_id, event_school_slug"
      )
      .in("step_id", stepIds)
      .order("ref_position", { ascending: true });
    if (refsErr)
      return NextResponse.json({ error: refsErr.message }, { status: 500 });
    refs = (refsData ?? []) as unknown as (StepRef & { step_id: string })[];
  }

  const refsByStep = new Map<string, StepRef[]>();
  for (const r of refs as Array<StepRef & { step_id: string }>) {
    const arr = refsByStep.get(r.step_id) ?? [];
    arr.push({
      id: r.id,
      ref_position: r.ref_position,
      step_type: r.step_type,
      event_ns: r.event_ns,
      redirect_event_id: r.redirect_event_id,
      event_school_slug: r.event_school_slug ?? null,
    });
    refsByStep.set(r.step_id, arr);
  }

  const steps: DashboardStep[] = stepRows.map((s) => ({
    id: s.id,
    position: s.position,
    label: s.label,
    refs: refsByStep.get(s.id) ?? [],
  }));

  const dashboard: DashboardWithSteps = {
    ...dashRes.data,
    can_edit: access.can_edit,
    steps,
  };
  return NextResponse.json({ dashboard });
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
  const access = await loadAccessible(id, user.userId);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!access.can_edit)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);

  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.name !== undefined) fields.name = parsed.data.name;
  if (parsed.data.date_preset !== undefined)
    fields.date_preset = parsed.data.date_preset;
  if (parsed.data.date_from !== undefined) fields.date_from = parsed.data.date_from;
  if (parsed.data.date_to !== undefined) fields.date_to = parsed.data.date_to;
  if (parsed.data.is_shared !== undefined)
    fields.is_shared = parsed.data.is_shared;

  if (Object.keys(fields).length > 1) {
    const { error } = await sb.from("dashboards").update(fields).eq("id", id);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (parsed.data.steps !== undefined) {
    // Atomic replace via RPC PL/pgSQL (cf. supabase/migrations/007).
    // Avant : DELETE + N INSERTs sequentiels sans transaction -> un crash
    // au milieu laissait le dashboard avec une moitie de steps. Maintenant
    // tout est dans une transaction PG, rollback automatique sur erreur.
    const stepsPayload = parsed.data.steps.map((step) => ({
      label: step.label ?? null,
      refs: step.refs.map((r) => ({
        step_type: r.step_type,
        event_ns: r.step_type === "mm_event" ? r.event_ns : null,
        redirect_event_id:
          r.step_type === "url_click" ? r.redirect_event_id : null,
        // Persisté uniquement pour les mm_event (la contrainte CHECK en
        // DB rejette une valeur non-NULL pour les url_click). En mode
        // école-précise le builder n'envoie pas ce champ → null.
        event_school_slug:
          r.step_type === "mm_event" ? r.event_school_slug ?? null : null,
      })),
    }));
    const { error: rpcErr } = await sb.rpc("replace_dashboard_steps", {
      p_dashboard_id: id,
      p_steps: stepsPayload,
    });
    if (rpcErr)
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
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
  const access = await loadAccessible(id, user.userId);
  if (!access) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!access.can_edit)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const { error } = await getSupabaseScoped(schoolSlug)
    .from("dashboards")
    .delete()
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
