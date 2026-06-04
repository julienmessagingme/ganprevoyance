import { getSupabaseScoped } from "@/lib/supabase/service";

/**
 * Shared helpers for the Q&R upload + edit flows. Kept here so the upload-qa
 * route AND the items PATCH route (Phase 4.2) reuse the same logic without
 * duplication.
 */

export interface DuplicateCheck {
  duplicate: boolean;
  field?: "question" | "answer";
}

/**
 * Checks if a question or answer already exists for the school's Q&R items.
 * `excludeId` lets the edit flow skip the row being modified.
 *
 * Two queries instead of one OR : the OR-query returns whichever match comes
 * first which makes it harder to know which field collided. Splitting lets
 * us return the precise field for a clearer toast in the UI.
 */
export async function findQaDuplicate(
  schoolSlug: string,
  question: string,
  answer: string,
  excludeId?: string
): Promise<DuplicateCheck> {
  const sb = getSupabaseScoped(schoolSlug);
  const trimmedQ = question.trim();
  const trimmedA = answer.trim();

  let qq = sb
    .from("knowledge_items")
    .select("id")
    .eq("school_slug", schoolSlug)
    .eq("type", "qa")
    .eq("question", trimmedQ)
    .limit(1);
  if (excludeId) qq = qq.neq("id", excludeId);
  const { data: qHit } = await qq.maybeSingle();
  if (qHit) return { duplicate: true, field: "question" };

  let aq = sb
    .from("knowledge_items")
    .select("id")
    .eq("school_slug", schoolSlug)
    .eq("type", "qa")
    .eq("answer", trimmedA)
    .limit(1);
  if (excludeId) aq = aq.neq("id", excludeId);
  const { data: aHit } = await aq.maybeSingle();
  if (aHit) return { duplicate: true, field: "answer" };

  return { duplicate: false };
}

/**
 * Validates that a theme/subtheme pair, if provided, both belong to the
 * given school. Returns the names so the caller can use them when building
 * the .txt file. Returns null if invalid (caller responds 400).
 */
export async function resolveThemeForSchool(
  schoolSlug: string,
  themeId: string | null,
  subthemeId: string | null
): Promise<{ themeName: string | null; subthemeName: string | null } | null> {
  const sb = getSupabaseScoped(schoolSlug);
  let themeName: string | null = null;
  let subthemeName: string | null = null;

  if (themeId) {
    const { data } = await sb
      .from("knowledge_themes")
      .select("name, school_slug")
      .eq("id", themeId)
      .maybeSingle();
    if (!data || data.school_slug !== schoolSlug) return null;
    themeName = data.name;
  }
  if (subthemeId) {
    const { data } = await sb
      .from("knowledge_subthemes")
      .select("name, school_slug, theme_id")
      .eq("id", subthemeId)
      .maybeSingle();
    if (!data || data.school_slug !== schoolSlug) return null;
    // If a themeId was provided, ensure the subtheme is linked to that
    // theme (defensive — UI should already enforce this).
    if (themeId && data.theme_id && data.theme_id !== themeId) return null;
    subthemeName = data.name;
  }
  return { themeName, subthemeName };
}
