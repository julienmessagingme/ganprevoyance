import { getSupabaseScoped } from "@/lib/supabase/service";
import { listEvents, iterOccurrences } from "./client";
import { env } from "@/lib/env";
import { SCHOOLS, getSchoolToken, type School } from "@/lib/schools";

export interface SyncResult {
  ok: number;
  errors: number;
  skipped: number;
}

export async function syncAllSchools(): Promise<SyncResult> {
  let ok = 0;
  let errors = 0;
  let skipped = 0;

  for (const school of SCHOOLS) {
    const token = getSchoolToken(school.slug);
    if (!token) {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "skip school: no token",
          school: school.slug,
        })
      );
      skipped++;
      continue;
    }
    try {
      await syncSchool(school, token);
      ok++;
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "school sync failed",
          school: school.slug,
          err: err instanceof Error ? err.message : String(err),
        })
      );
      errors++;
    }
  }
  return { ok, errors, skipped };
}

export async function syncSchool(school: School, token: string): Promise<void> {
  const sb = getSupabaseScoped(school.slug);
  const base = env.messagingmeBase;
  const events = await listEvents({ token, base });

  // Refresh the events catalog for this school. We upsert so renames /
  // description changes propagate and a removed event simply stops getting
  // its occurrences synced (we don't delete the row to preserve historical
  // occurrences and stats).
  if (events.length > 0) {
    const { error } = await sb.from("mm_events").upsert(
      events.map((e) => ({
        school_slug: school.slug,
        event_ns: e.event_ns,
        name: e.name,
        description: e.description,
        text_label: e.text_label,
        price_label: e.price_label,
        number_label: e.number_label,
        last_synced_at: new Date().toISOString(),
      })),
      { onConflict: "school_slug,event_ns" }
    );
    if (error) throw error;
  }

  for (const ev of events) {
    try {
      await syncEventOccurrences(school.slug, ev.event_ns, token, base);
      await sb.from("mm_sync_state").upsert(
        {
          school_slug: school.slug,
          event_ns: ev.event_ns,
          last_run_at: new Date().toISOString(),
          last_run_status: "success",
          last_run_error: null,
        },
        { onConflict: "school_slug,event_ns" }
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "event sync failed",
          school: school.slug,
          event_ns: ev.event_ns,
          err: err instanceof Error ? err.message : String(err),
        })
      );
      await sb.from("mm_sync_state").upsert(
        {
          school_slug: school.slug,
          event_ns: ev.event_ns,
          last_run_at: new Date().toISOString(),
          last_run_status: "error",
          last_run_error: err instanceof Error ? err.message : String(err),
        },
        { onConflict: "school_slug,event_ns" }
      );
      // Continue to the next event — one bad event shouldn't poison the
      // rest of the school's sync.
    }
  }
}

async function syncEventOccurrences(
  schoolSlug: string,
  eventNs: string,
  token: string,
  base: string
): Promise<void> {
  const sb = getSupabaseScoped(schoolSlug);

  const { data: state } = await sb
    .from("mm_sync_state")
    .select("last_occurrence_id")
    .eq("school_slug", schoolSlug)
    .eq("event_ns", eventNs)
    .maybeSingle();
  const watermark = state?.last_occurrence_id ?? 0;

  let maxIngested = watermark;

  // L'API renvoie les occurrences par id CROISSANT via le curseur `start_id`
  // (exclusif). On part du watermark et on ingère TOUTES les pages jusqu'au
  // bout, sans break précoce — l'ancienne logique (ordre descendant + break dès
  // id <= watermark) gelait chaque event après le backfill (cf. LEARNINGS
  // 2026-06-02). Upsert idempotent sur la PK (school_slug, id) : un retry en
  // milieu de pagination ne crée jamais de doublon. Watermark = max id
  // réellement inséré.
  for await (const batch of iterOccurrences({ token, base }, eventNs, watermark)) {
    if (batch.length === 0) continue;
    const { error } = await sb
      .from("mm_occurrences")
      .upsert(
        batch.map((o) => ({
          id: o.id,
          school_slug: schoolSlug,
          event_ns: o.event_ns,
          user_ns: o.user_ns,
          text_value: o.text_value,
          price_value: parsePriceValue(o.price_value),
          number_value: o.number_value,
          occurred_at: o.created_at,
        })),
        { onConflict: "school_slug,id", ignoreDuplicates: true }
      );
    if (error) throw error;
    for (const o of batch) if (o.id > maxIngested) maxIngested = o.id;
  }

  if (maxIngested > watermark) {
    const { error } = await sb.from("mm_sync_state").upsert(
      {
        school_slug: schoolSlug,
        event_ns: eventNs,
        last_occurrence_id: maxIngested,
      },
      { onConflict: "school_slug,event_ns" }
    );
    if (error) throw error;
  }
}

function parsePriceValue(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
