import { NextResponse } from "next/server";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { resolveDateRange } from "@/lib/dashboards/date-range";
import { groupMetaCostsByCountry } from "@/lib/meta-pricing";
import type {
  MetaCostBreakdownItem,
  CampaignCostSummary,
} from "@/lib/dashboards/types";
import type {
  ComputedRef,
  ComputedStep,
  ComputedDashboardData,
  DatePreset,
  StepType,
} from "@/lib/dashboards/types";

export const runtime = "nodejs";

interface DashboardRow {
  id: string;
  created_by: string;
  school_slug: string;
  date_preset: DatePreset;
  date_from: string | null;
  date_to: string | null;
  campaign_id: string | null;
}

interface StepRow {
  id: string;
  position: number;
  label: string | null;
}

interface RefRow {
  id: string;
  step_id: string;
  ref_position: number;
  step_type: StepType;
  event_ns: string | null;
  redirect_event_id: string | null;
  event_school_slug: string | null;
}

function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
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
  const scope = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(scope);

  const { data: dash } = await sb
    .from("dashboards")
    .select(
      "id, created_by, school_slug, date_preset, date_from, date_to, campaign_id, is_shared"
    )
    .eq("id", id)
    .maybeSingle<DashboardRow>();

  if (!dash || dash.school_slug !== scope) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Visibilité : owner OR is_shared OR lié à une campagne (les
  // tableaux de campagne s'affichent à tous ceux qui voient la
  // campagne, géré côté campagne). On accepte les 3 cas ici puisque
  // l'API listing les filtre déjà en amont — c'est un garde-fou.
  // Note : `is_shared` n'existe que sur les tableaux libres (campaign_id
  // null) ; pour un tableau de campagne, la visibilité est gérée par
  // les ACL de la campagne (cf. /campaigns/[id]/campaign-page-client).
  const dashAny = dash as DashboardRow & { is_shared?: boolean };
  const visible =
    dashAny.created_by === user.userId ||
    dashAny.is_shared === true ||
    dashAny.campaign_id !== null;
  if (!visible) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Capture non-null pour que TS ne perde pas le narrowing à l'intérieur
  // de la closure `computeRef`.
  const dashSchool = dash.school_slug;

  const { data: stepsData, error: stepsErr } = await sb
    .from("dashboard_steps")
    .select("id, position, label")
    .eq("dashboard_id", id)
    .order("position", { ascending: true });
  if (stepsErr)
    return NextResponse.json({ error: stepsErr.message }, { status: 500 });

  const stepRows = (stepsData ?? []) as StepRow[];

  const { from, to } = resolveDateRange({
    preset: dash.date_preset,
    from: dash.date_from,
    to: dash.date_to,
  });
  const fromTs = `${from}T00:00:00Z`;
  const toTs = `${nextDay(to)}T00:00:00Z`;

  if (stepRows.length === 0) {
    const empty: ComputedDashboardData = { from, to, steps: [] };
    return NextResponse.json(empty);
  }

  const stepIds = stepRows.map((s) => s.id);
  const { data: refsData, error: refsErr } = await sb
    .from("dashboard_step_refs")
    .select(
      "id, step_id, ref_position, step_type, event_ns, redirect_event_id, event_school_slug"
    )
    .in("step_id", stepIds)
    .order("ref_position", { ascending: true });
  if (refsErr)
    return NextResponse.json({ error: refsErr.message }, { status: 500 });

  const refRows = (refsData ?? []) as RefRow[];

  // Si le dashboard est lié à une campagne, on récupère ses refs maintenant
  // pour pouvoir inclure les event_ns du launch/failed dans mmLabels — sinon
  // un funnel constitué uniquement d'URLs (zéro mm_event en step) verrait
  // son bloc campaign_summary skippé faute de label disponible.
  type CampaignRefRow = {
    step_type: StepType;
    event_ns: string | null;
    redirect_event_id: string | null;
    event_school_slug: string | null;
    role: "launch" | "body" | "failed";
  };
  let campaignRefs: CampaignRefRow[] = [];
  if (dash.campaign_id) {
    const { data: cRefs } = await sb
      .from("campaign_refs")
      .select(
        "step_type, event_ns, redirect_event_id, event_school_slug, role"
      )
      .eq("campaign_id", dash.campaign_id);
    campaignRefs = (cRefs ?? []) as CampaignRefRow[];
  }

  // Pour chaque mm_event ref, l'école est celle du dashboard (single-school).
  type MmKey = string; // `${school}|${event_ns}`
  const mmKeys = new Set<MmKey>();
  for (const r of refRows) {
    if (r.step_type === "mm_event" && r.event_ns) {
      mmKeys.add(`${dashSchool}|${r.event_ns}`);
    }
  }
  // Seed mmKeys avec les events launch/failed de la campagne pour garantir
  // qu'on charge bien leur label, même si la campagne n'a aucun mm_event
  // drag-and-droppé en step (cas d'un funnel 100% URL clicks).
  for (const r of campaignRefs) {
    if (
      (r.role === "launch" || r.role === "failed") &&
      r.step_type === "mm_event" &&
      r.event_ns
    ) {
      mmKeys.add(`${dashSchool}|${r.event_ns}`);
    }
  }
  const mmKeyList = Array.from(mmKeys);
  const redirectIdList = Array.from(
    new Set(
      refRows
        .filter((r) => r.step_type === "url_click")
        .map((r) => r.redirect_event_id!)
    )
  );

  const involvedSchools = Array.from(
    new Set(mmKeyList.map((k) => k.split("|")[0]!))
  );
  const [mmLabelsRes, redirectLabelsRes] = await Promise.all([
    involvedSchools.length > 0
      ? sb
          .from("mm_events")
          .select("school_slug, event_ns, name, text_label")
          .in("school_slug", involvedSchools)
      : Promise.resolve({ data: [], error: null }),
    redirectIdList.length > 0
      ? sb
          .from("redirect_events")
          .select("id, name, school_slug")
          .in("id", redirectIdList)
      : Promise.resolve({ data: [], error: null }),
  ]);

  // mmLabels = nom de l'event + indicateur "porteur de texte" (text_label
  // non vide). On stocke l'objet entier pour pouvoir décider, dans
  // computeRef, si l'event mérite un calcul de coût Meta.
  const mmLabels = new Map<MmKey, { name: string; textLabel: string }>();
  for (const r of (mmLabelsRes.data as {
    school_slug: string;
    event_ns: string;
    name: string;
    text_label: string | null;
  }[]) ?? []) {
    mmLabels.set(`${r.school_slug}|${r.event_ns}`, {
      name: r.name,
      textLabel: (r.text_label ?? "").trim(),
    });
  }
  const redirectLabels = new Map<
    string,
    { name: string; school_slug: string }
  >();
  for (const r of (redirectLabelsRes.data as {
    id: string;
    name: string;
    school_slug: string;
  }[]) ?? []) {
    // On n'expose que les redirects de l'école courante.
    if (r.school_slug === dashSchool) {
      redirectLabels.set(r.id, { name: r.name, school_slug: r.school_slug });
    }
  }

  const refsByStep = new Map<string, RefRow[]>();
  for (const r of refRows) {
    const arr = refsByStep.get(r.step_id) ?? [];
    arr.push(r);
    refsByStep.set(r.step_id, arr);
  }

  async function computeRef(r: RefRow): Promise<ComputedRef> {
    if (r.step_type === "mm_event") {
      const evNs = r.event_ns!;
      const key = `${dashSchool}|${evNs}`;
      const available = mmLabels.has(key);
      if (!available) {
        return {
          step_type: "mm_event",
          ref_id: evNs,
          label: "(indisponible)",
          count: 0,
          available: false,
        };
      }
      const meta = mmLabels.get(key)!;
      const isPhoneCarrier = meta.textLabel.length > 0;

      let count: number;
      let metaCostEur: number | null;
      let metaBreakdown: MetaCostBreakdownItem[] | undefined;
      if (isPhoneCarrier) {
        // Event porteur (text_label non vide) → on fetch les text_value
        // pour calculer le coût Meta marketing par indicatif. Limite à
        // 10 000 rows par event/période (au-delà, le coût sera sous-évalué
        // et un warning serait à ajouter en V2).
        const { data: occRows, error: occErr } = await sb
          .from("mm_occurrences")
          .select("text_value")
          .eq("school_slug", dashSchool)
          .eq("event_ns", evNs)
          .gte("occurred_at", fromTs)
          .lt("occurred_at", toTs)
          .limit(10000);
        if (occErr) {
          count = 0;
          metaCostEur = null;
        } else {
          const rows = (occRows ?? []) as { text_value: string | null }[];
          count = rows.length;
          const phones = rows
            .map((r) => r.text_value ?? "")
            .filter((p) => p.length > 0);
          const breakdown = groupMetaCostsByCountry(phones);
          metaBreakdown = breakdown.map((b) => ({
            iso: b.iso,
            name: b.name,
            count: b.count,
            rate_eur: b.rateEur,
            total_eur: b.totalEur,
          }));
          metaCostEur = metaBreakdown.reduce((s, b) => s + b.total_eur, 0);
        }
      } else {
        // Event "compteur" classique : count(*) suffit.
        const { count: c } = await sb
          .from("mm_occurrences")
          .select("*", { count: "exact", head: true })
          .eq("school_slug", dashSchool)
          .eq("event_ns", evNs)
          .gte("occurred_at", fromTs)
          .lt("occurred_at", toTs);
        count = c ?? 0;
        metaCostEur = null;
      }

      return {
        step_type: "mm_event",
        ref_id: evNs,
        label: meta.name,
        count,
        available: true,
        meta_cost_eur: metaCostEur,
        ...(metaBreakdown ? { meta_breakdown: metaBreakdown } : {}),
      };
    }
    const reId = r.redirect_event_id!;
    const meta = redirectLabels.get(reId);
    if (!meta) {
      return {
        step_type: "url_click",
        ref_id: reId,
        label: "(indisponible)",
        count: 0,
        available: false,
      };
    }
    const { count } = await sb
      .from("clicks")
      .select("*", { count: "exact", head: true })
      .eq("event_id", reId)
      .gte("clicked_at", fromTs)
      .lt("clicked_at", toTs);
    return {
      step_type: "url_click",
      ref_id: reId,
      label: meta.name,
      count: count ?? 0,
      available: true,
    };
  }

  const computed: ComputedStep[] = await Promise.all(
    stepRows.map(async (s): Promise<ComputedStep> => {
      const stepRefs = refsByStep.get(s.id) ?? [];
      const computedRefs = await Promise.all(stepRefs.map(computeRef));
      const total = computedRefs
        .filter((r) => r.available)
        .reduce((sum, r) => sum + r.count, 0);
      const anyAvailable = computedRefs.some((r) => r.available);
      const fallbackLabel =
        computedRefs.length === 0
          ? "(vide)"
          : computedRefs.map((r) => r.label).join(" + ");
      // Coût Meta de l'étape = somme des coûts des refs porteurs. NULL si
      // aucune ref n'a de coût → la colonne « Coût Meta » de la table
      // récap reste masquée pour cette étape (et masquée globalement si
      // aucune étape n'a de coût).
      const carriers = computedRefs.filter(
        (r) => r.available && r.meta_cost_eur != null
      );
      const metaCostEur =
        carriers.length > 0
          ? carriers.reduce((acc, r) => acc + (r.meta_cost_eur ?? 0), 0)
          : null;
      // Fusion des breakdown des refs porteurs en un seul breakdown au
      // niveau du step. Si deux refs ramènent du même pays, on additionne
      // count + total et on garde le rate (cohérent par hypothèse).
      let metaBreakdown: MetaCostBreakdownItem[] | undefined;
      if (carriers.length > 0) {
        const merged = new Map<string, MetaCostBreakdownItem>();
        for (const r of carriers) {
          for (const b of r.meta_breakdown ?? []) {
            const existing = merged.get(b.iso);
            if (existing) {
              existing.count += b.count;
              existing.total_eur += b.total_eur;
            } else {
              merged.set(b.iso, { ...b });
            }
          }
        }
        metaBreakdown = Array.from(merged.values()).sort(
          (a, b) => b.total_eur - a.total_eur
        );
      }
      return {
        position: s.position,
        label: s.label && s.label.trim() ? s.label : fallbackLabel,
        count: anyAvailable ? total : 0,
        available: anyAvailable && computedRefs.length > 0,
        refs: computedRefs,
        meta_cost_eur: metaCostEur,
        ...(metaBreakdown ? { meta_breakdown: metaBreakdown } : {}),
      };
    })
  );

  // --- Injection launch/failed comme steps synthétiques (Phase 25.5) ---
  // Le dashboard ne stocke que les "body steps" en DB. Pour l'affichage du
  // funnel d'une campagne, on préfixe la step launch et on suffixe la step
  // failed, pour avoir un funnel complet "Envoyés → … → Échoués" dans le
  // chart et la table. Réutilise computeRef pour avoir le count + coût Meta.
  if (dash.campaign_id) {
    const launchRefCfg = campaignRefs.find((r) => r.role === "launch");
    const failedRefCfg = campaignRefs.find((r) => r.role === "failed");

    const synthStep = async (
      cfg: CampaignRefRow,
      labelPrefix: string,
      role: "launch" | "failed"
    ): Promise<ComputedStep | null> => {
      if (cfg.step_type !== "mm_event" || !cfg.event_ns) return null;
      const synthRefRow: RefRow = {
        id: `synth-${cfg.role}`,
        step_id: `synth-${cfg.role}`,
        ref_position: 0,
        step_type: "mm_event",
        event_ns: cfg.event_ns,
        redirect_event_id: null,
        event_school_slug: cfg.event_school_slug,
      };
      const cr = await computeRef(synthRefRow);
      return {
        position: 0, // renuméroté en bas
        label: `${labelPrefix} : ${cr.label}`,
        count: cr.available ? cr.count : 0,
        available: cr.available,
        refs: [cr],
        meta_cost_eur: cr.meta_cost_eur ?? null,
        ...(cr.meta_breakdown ? { meta_breakdown: cr.meta_breakdown } : {}),
        synth_role: role,
      };
    };

    const launchStep = launchRefCfg
      ? await synthStep(launchRefCfg, "Lancement", "launch")
      : null;
    const failedStep = failedRefCfg
      ? await synthStep(failedRefCfg, "Échec", "failed")
      : null;

    if (launchStep) computed.unshift(launchStep);
    if (failedStep) computed.push(failedStep);
    // Renumérote pour avoir 1..N continu (sinon le bar chart / table affiche
    // les positions originales et c'est confus).
    computed.forEach((s, i) => {
      s.position = i + 1;
    });
  }

  // --- Synthèse campagne (Phase 25) ---
  // Si le dashboard est lié à une campagne avec un launch défini, on
  // calcule le coût Meta brut (lancement), le failed éventuel, et le
  // net (= lancement scaled par le ratio des envois réussis).
  // Réutilise les `campaignRefs` chargés plus haut pour le seed mmKeys.
  let campaignSummary: CampaignCostSummary | null = null;
  if (dash.campaign_id) {
    const launchRef = campaignRefs.find((r) => r.role === "launch");
    const failedRef = campaignRefs.find((r) => r.role === "failed");

    if (launchRef && launchRef.step_type === "mm_event" && launchRef.event_ns) {
      const launchKey = `${dashSchool}|${launchRef.event_ns}`;
      const launchLabelMeta = mmLabels.get(launchKey);

      if (launchLabelMeta) {
        const { data: launchOccs } = await sb
          .from("mm_occurrences")
          .select("text_value")
          .eq("school_slug", dashSchool)
          .eq("event_ns", launchRef.event_ns)
          .gte("occurred_at", fromTs)
          .lt("occurred_at", toTs)
          .limit(10000);
        const launchPhones = ((launchOccs ?? []) as {
          text_value: string | null;
        }[])
          .map((r) => r.text_value ?? "")
          .filter((p) => p.length > 0);
        const launchCount = (launchOccs ?? []).length;
        const launchBreakdown = groupMetaCostsByCountry(launchPhones).map(
          (b): MetaCostBreakdownItem => ({
            iso: b.iso,
            name: b.name,
            count: b.count,
            rate_eur: b.rateEur,
            total_eur: b.totalEur,
          })
        );
        const launchCost = launchBreakdown.reduce(
          (s, b) => s + b.total_eur,
          0
        );

        let failedCount = 0;
        let failedLabel = "";
        if (failedRef && failedRef.step_type === "mm_event" && failedRef.event_ns) {
          const failedKey = `${dashSchool}|${failedRef.event_ns}`;
          const failedMeta = mmLabels.get(failedKey);
          if (failedMeta) {
            const { count: fc } = await sb
              .from("mm_occurrences")
              .select("*", { count: "exact", head: true })
              .eq("school_slug", dashSchool)
              .eq("event_ns", failedRef.event_ns)
              .gte("occurred_at", fromTs)
              .lt("occurred_at", toTs);
            failedCount = fc ?? 0;
            failedLabel = failedMeta.name;
          }
        }

        // Net = launch scaled par (net_count / launch_count). On cap à 0
        // si plus de failed que de launch (cas pathologique mais possible
        // si les events sont mal configurés / mal alignés temporellement).
        const netCount = Math.max(0, launchCount - failedCount);
        const ratio = launchCount > 0 ? netCount / launchCount : 0;
        const netBreakdown: MetaCostBreakdownItem[] = launchBreakdown.map(
          (b) => ({
            ...b,
            count: Math.round(b.count * ratio),
            total_eur: b.total_eur * ratio,
          })
        );
        const netCost = launchCost * ratio;

        campaignSummary = {
          launch: {
            count: launchCount,
            cost_eur: launchCost,
            breakdown: launchBreakdown,
            label: launchLabelMeta.name,
            event_ns: launchRef.event_ns,
            event_school_slug: launchRef.event_school_slug ?? null,
          },
          failed:
            failedRef && failedRef.event_ns
              ? {
                  count: failedCount,
                  label: failedLabel || "(indisponible)",
                  event_ns: failedRef.event_ns,
                  event_school_slug: failedRef.event_school_slug ?? null,
                }
              : null,
          net_count: netCount,
          net_cost_eur: netCost,
          net_breakdown: netBreakdown,
        };
      }
    }
  }

  const body: ComputedDashboardData = {
    from,
    to,
    steps: computed,
    campaign_summary: campaignSummary,
  };
  return NextResponse.json(body);
}
