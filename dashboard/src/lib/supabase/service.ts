import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let _client: SupabaseClient | null = null;

/**
 * Raw service-role client. Bypasse toutes les protections school-scoped.
 *
 * À RÉSERVER aux opérations admin sur les tables sans `school_slug` :
 *   - `users` (création/modification d'utilisateurs)
 *   - `user_school_access` (gestion des accès)
 *   - `redirect_versions` / `clicks` / `dashboard_steps` / `dashboard_step_refs` /
 *     `campaign_refs` quand on a déjà résolu le school_slug via le parent FK.
 *
 * Pour TOUT le reste, utiliser `getSupabaseScoped(slug)` ci-dessous.
 */
export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false },
    });
  }
  return _client;
}

/**
 * Tables qui ont une colonne `school_slug` directement et doivent toujours
 * être filtrées dessus. Le wrapper `getSupabaseScoped(slug)` enforce ça :
 *
 *   - SELECT : auto-injecte `.eq('school_slug', slug)` avant tout autre filtre.
 *   - INSERT/UPSERT : force `school_slug=slug` dans le payload, throw si un
 *     autre slug est passé.
 *   - UPDATE : throw si le payload tente de muter `school_slug`.
 *   - DELETE : auto-injecte `.eq('school_slug', slug)` (un DELETE sans WHERE
 *     sur school_slug pourrait toucher d'autres écoles).
 */
const DIRECT_SCHOOL_TABLES = new Set<string>([
  "redirect_events",
  "mm_events",
  "mm_occurrences",
  "mm_sync_state",
  "knowledge_themes",
  "knowledge_subthemes",
  "knowledge_items",
  "dashboards",
  "campaigns",
]);

/**
 * Tables sans `school_slug` direct mais auxquelles on accède de manière scoped
 * via leur FK parente. Le wrapper laisse passer sans filtre auto — c'est au
 * code appelant de filtrer via la FK (.in('event_id', ids_from_parent)). On
 * les liste quand même pour pouvoir distinguer "table existante, scope géré
 * manuellement" de "table inconnue, probable typo".
 */
const FK_SCOPED_TABLES = new Set<string>([
  "redirect_versions",
  "clicks",
  "dashboard_steps",
  "dashboard_step_refs",
  "campaign_refs",
]);

/**
 * Tables globales (pas de school_slug, pas de scope). Le wrapper rejette
 * tout accès — il faut explicitement utiliser `getSupabase()` raw.
 */
const GLOBAL_TABLES = new Set<string>([
  "users",
  "user_school_access",
]);

function isMutationWithSchoolSlugConflict(payload: unknown, slug: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  const rows = Array.isArray(payload) ? payload : [payload];
  return rows.some((row) => {
    if (!row || typeof row !== "object") return false;
    const v = (row as Record<string, unknown>).school_slug;
    return v !== undefined && v !== slug;
  });
}

function injectSchoolSlug<T>(payload: T, slug: string): T {
  if (Array.isArray(payload)) {
    return payload.map((row) =>
      row && typeof row === "object"
        ? { ...(row as Record<string, unknown>), school_slug: slug }
        : row
    ) as unknown as T;
  }
  if (payload && typeof payload === "object") {
    return { ...(payload as Record<string, unknown>), school_slug: slug } as unknown as T;
  }
  return payload;
}

function wrapBuilder(
  builder: unknown,
  slug: string,
  table: string
): unknown {
  return new Proxy(builder as object, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== "function") return orig;

      // Intercept the verbs that initiate a request type.
      if (prop === "select") {
        return (...args: unknown[]) => {
          const next = (orig as (...a: unknown[]) => unknown).apply(target, args);
          // @ts-expect-error supabase builder dynamic
          return next.eq("school_slug", slug);
        };
      }
      if (prop === "insert" || prop === "upsert") {
        return (...args: unknown[]) => {
          const [payload, ...rest] = args;
          if (isMutationWithSchoolSlugConflict(payload, slug)) {
            throw new Error(
              `[getSupabaseScoped] ${String(prop)} into '${table}' with school_slug !== '${slug}' is forbidden`
            );
          }
          const scoped = injectSchoolSlug(payload, slug);
          return (orig as (...a: unknown[]) => unknown).apply(target, [scoped, ...rest]);
        };
      }
      if (prop === "update") {
        return (...args: unknown[]) => {
          const [payload, ...rest] = args;
          if (
            payload &&
            typeof payload === "object" &&
            "school_slug" in (payload as Record<string, unknown>) &&
            (payload as Record<string, unknown>).school_slug !== slug
          ) {
            throw new Error(
              `[getSupabaseScoped] update on '${table}' that mutates school_slug is forbidden`
            );
          }
          const builderAfterUpdate = (orig as (...a: unknown[]) => unknown).apply(
            target,
            [payload, ...rest]
          );
          // @ts-expect-error supabase builder dynamic
          return builderAfterUpdate.eq("school_slug", slug);
        };
      }
      if (prop === "delete") {
        return (...args: unknown[]) => {
          const next = (orig as (...a: unknown[]) => unknown).apply(target, args);
          // @ts-expect-error supabase builder dynamic
          return next.eq("school_slug", slug);
        };
      }

      // Other methods : pass-through binding.
      return (orig as (...a: unknown[]) => unknown).bind(target);
    },
  });
}

/**
 * Client Supabase school-scoped. À utiliser pour TOUTES les requêtes sur des
 * tables porteuses d'un `school_slug` (cf. `DIRECT_SCHOOL_TABLES`).
 *
 * Le wrapper Proxy intercepte `.from(table)` :
 *   - Table dans DIRECT_SCHOOL_TABLES → builder qui auto-filtre/inject le slug
 *   - Table dans FK_SCOPED_TABLES → builder normal (scope géré par le code via FK)
 *   - Table dans GLOBAL_TABLES → throw (utiliser getSupabase() raw)
 *   - Table inconnue → throw (probable typo)
 *
 * Pour les méthodes autres que `.from()` (`.rpc()`, `.storage`, etc.), pass-through
 * au client raw. Penser à les sécuriser au cas par cas si on en ajoute.
 */
export function getSupabaseScoped(slug: string): SupabaseClient {
  if (!slug || typeof slug !== "string") {
    throw new Error("[getSupabaseScoped] slug is required");
  }
  const base = getSupabase();
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table: string) => {
          if (DIRECT_SCHOOL_TABLES.has(table)) {
            return wrapBuilder(target.from(table), slug, table);
          }
          if (FK_SCOPED_TABLES.has(table)) {
            return target.from(table);
          }
          if (GLOBAL_TABLES.has(table)) {
            throw new Error(
              `[getSupabaseScoped] table '${table}' is global (no school scoping). Use getSupabase() raw.`
            );
          }
          throw new Error(
            `[getSupabaseScoped] unknown table '${table}'. Add it to DIRECT_SCHOOL_TABLES, FK_SCOPED_TABLES, or GLOBAL_TABLES in src/lib/supabase/service.ts.`
          );
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as SupabaseClient;
}
