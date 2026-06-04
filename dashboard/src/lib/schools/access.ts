import { getSupabase } from "@/lib/supabase/service";
import { SCHOOLS, isValidSchoolSlug } from "@/lib/schools";

/**
 * Return the school slugs the user has access to, ordered by the canonical
 * `SCHOOLS` constant order so the sidebar is deterministic regardless of
 * insertion order in `user_school_access`. Les slugs inconnus en DB
 * (e.g. une école renommée) sont écartés.
 */
export async function getCurrentUserSchools(userId: string): Promise<string[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("user_school_access")
    .select("school_slug")
    .eq("user_id", userId);
  if (error) throw error;
  const allowed = new Set(
    (data ?? [])
      .map((r) => (r as { school_slug: string }).school_slug)
      .filter(isValidSchoolSlug)
  );
  return SCHOOLS.map((s) => s.slug).filter((s) => allowed.has(s));
}
