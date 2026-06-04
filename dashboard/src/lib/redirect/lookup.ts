import { getSupabaseScoped } from "@/lib/supabase/service";
import { DEFAULT_SCHOOL_SLUG } from "@/lib/schools";

export interface RedirectLookup {
  eventId: string;
  versionId: string;
  destinationUrl: string;
  schoolSlug: string;
}

const TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 5_000;
const cache = new Map<string, { value: RedirectLookup | null; expiresAt: number }>();

function setCache(slug: string, value: RedirectLookup | null) {
  // FIFO eviction once we exceed cap : drops the oldest insertion order.
  // This bounds memory at ~5k entries even under negative-lookup attack.
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(slug, { value, expiresAt: Date.now() + TTL_MS });
}

// Periodic sweep of expired entries, prevents the Map from holding stale
// negative caches forever even if the FIFO never runs.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
}, TTL_MS).unref?.();

export async function lookupSlug(slug: string): Promise<RedirectLookup | null> {
  const cached = cache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  // Single-school deployment : on scope sur DEFAULT_SCHOOL_SLUG ('gan-prev'). Le
  // wrapper Proxy injecte automatiquement `.eq('school_slug', 'gan-prev')` sur
  // le SELECT, ce qui empêche par construction de rediriger vers un slug
  // d'une autre école (la DB est partagée).
  const sb = getSupabaseScoped(DEFAULT_SCHOOL_SLUG);
  const { data: ev } = await sb
    .from("redirect_events")
    .select("id, slug, school_slug")
    .eq("slug", slug)
    .is("archived_at", null)
    .maybeSingle();

  if (!ev) {
    setCache(slug, null);
    return null;
  }

  const { data: ver } = await sb
    .from("redirect_versions")
    .select("id, destination_url, version")
    .eq("event_id", ev.id)
    .is("active_to", null)
    .maybeSingle();

  if (!ver) {
    setCache(slug, null);
    return null;
  }

  const value: RedirectLookup = {
    eventId: ev.id,
    versionId: ver.id,
    destinationUrl: ver.destination_url,
    schoolSlug: ev.school_slug,
  };
  setCache(slug, value);
  return value;
}

export function invalidateSlugCache(slug: string) {
  cache.delete(slug);
}
