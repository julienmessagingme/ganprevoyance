import { cookies } from "next/headers";
import { isValidSchoolSlug, DEFAULT_SCHOOL_SLUG } from "@/lib/schools";
import { getCurrentUserSchools } from "@/lib/schools/access";
import { requireUser } from "@/lib/auth/require-user";

export const SCHOOL_COOKIE_NAME = "ganprev_school";

export async function getCurrentSchoolSlug(): Promise<string> {
  const c = await cookies();
  const v = c.get(SCHOOL_COOKIE_NAME)?.value;
  if (v && isValidSchoolSlug(v)) return v;
  return DEFAULT_SCHOOL_SLUG;
}

/**
 * Like `getCurrentSchoolSlug` but enforces that the current user has access
 * to the slug. Si l'école courante a été révoquée, on rabat sur la première
 * école autorisée. Throws 403 si l'utilisateur n'a aucun accès école.
 *
 * Internally calls `requireUser()` (memoized via React `cache()`) so it's
 * cheap to use even alongside another `requireUser()` call in the same route.
 */
export async function getCurrentSchoolSlugChecked(): Promise<string> {
  const slug = await getCurrentSchoolSlug();
  const user = await requireUser();
  const schools = await getCurrentUserSchools(user.userId);
  if (schools.length === 0) {
    throw Object.assign(new Error("no school access"), { status: 403 });
  }
  if (schools.includes(slug)) return slug;
  return schools[0];
}
