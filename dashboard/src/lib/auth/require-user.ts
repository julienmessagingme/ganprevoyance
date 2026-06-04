import { cookies } from "next/headers";
import { cache } from "react";
import { verifySession, SESSION_COOKIE_NAME, SessionPayload } from "./session";
import { getSupabase } from "@/lib/supabase/service";

/**
 * `cache()` deduplicates requireUser within a single request : multiple
 * routes/helpers that all need the current user (e.g. an API handler that
 * uses both requireUser and getCurrentSchoolSlugChecked) only pay for one
 * cookie read + JWT verify + deactivated check.
 */
export const requireUser = cache(async (): Promise<SessionPayload> => {
  const c = await cookies();
  const tok = c.get(SESSION_COOKIE_NAME)?.value;
  if (!tok) throw Object.assign(new Error("unauthenticated"), { status: 401 });
  const payload = await verifySession(tok);
  if (!payload) throw Object.assign(new Error("invalid session"), { status: 401 });

  // Vérifie que l'user n'a pas été désactivé entre-temps (admin l'a soft-deleted).
  const sb = getSupabase();
  const { data } = await sb
    .from("users")
    .select("deactivated_at")
    .eq("id", payload.userId)
    .maybeSingle();
  if (!data) throw Object.assign(new Error("user not found"), { status: 401 });
  if (data.deactivated_at)
    throw Object.assign(new Error("deactivated"), { status: 401 });

  return payload;
});

/**
 * Like `requireUser` but additionally checks that `is_admin = true` in the DB.
 * Throws 403 if the user is no longer an admin (e.g. another admin
 * demoted them since they logged in).
 */
export const requireAdmin = cache(async (): Promise<SessionPayload> => {
  const user = await requireUser();
  const sb = getSupabase();
  const { data } = await sb
    .from("users")
    .select("is_admin")
    .eq("id", user.userId)
    .maybeSingle();
  if (!data?.is_admin)
    throw Object.assign(new Error("forbidden"), { status: 403 });
  return user;
});
