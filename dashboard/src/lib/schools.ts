export interface School {
  slug: string;
  name: string;
  tokenEnv: string;
  vectorStoreEnv: string;
  /** Public URL of the school's logo, served from /public/logos/<slug>.png. */
  logo: string;
}

/** Logo de marque affiché en haut à gauche du shell. */
export const BRAND_LOGO = "/logos/ganprev.png";

/** Logo MessagingMe (rendu dans le footer du shell auth-gated). */
export const MESSAGINGME_LOGO = "/logos/messagingme.png";

export const SCHOOLS: readonly School[] = [
  { slug: "gan-prev", name: "Gan Prévoyance", tokenEnv: "MM_TOKEN_GANPREV", vectorStoreEnv: "OPENAI_VS_GANPREV", logo: "/logos/ganprev.png" },
] as const;

const SLUG_SET = new Set(SCHOOLS.map((s) => s.slug));

/** Liste des slugs d'école pour ce déploiement (Gan Prévoyance seul). */
export const SCHOOL_SLUGS: readonly string[] = SCHOOLS.map((s) => s.slug);

export function isValidSchoolSlug(slug: string): boolean {
  return SLUG_SET.has(slug);
}

export function getSchoolBySlug(slug: string): School | undefined {
  return SCHOOLS.find((s) => s.slug === slug);
}

export function getSchoolToken(slug: string): string | undefined {
  const s = getSchoolBySlug(slug);
  if (!s) return undefined;
  return process.env[s.tokenEnv];
}

export function getSchoolVectorStoreId(slug: string): string | undefined {
  const s = getSchoolBySlug(slug);
  if (!s) return undefined;
  return process.env[s.vectorStoreEnv];
}

export const DEFAULT_SCHOOL_SLUG = SCHOOLS[0].slug;

/**
 * Logs a warning for each school whose env config is incomplete, plus a
 * single warning if OPENAI_API_KEY is missing. Call at boot (instrumentation)
 * so misconfig surfaces in the logs early, not as silent 401s during a sync
 * run or 500s when someone tries to upload to a knowledge base.
 *
 * Returns the list of school slugs that have at least one piece of missing
 * config. Mostly useful for tests.
 */
export function warnMissingSchoolTokens(): string[] {
  const missing: string[] = [];
  for (const s of SCHOOLS) {
    let hasMissing = false;
    if (!process.env[s.tokenEnv]) {
      hasMissing = true;
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "school messagingme token missing — sync will skip this school",
          school: s.slug,
          envVar: s.tokenEnv,
        })
      );
    }
    if (!process.env[s.vectorStoreEnv]) {
      hasMissing = true;
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "school OpenAI vector store id missing — knowledge uploads will fail",
          school: s.slug,
          envVar: s.vectorStoreEnv,
        })
      );
    }
    if (hasMissing) missing.push(s.slug);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "OPENAI_API_KEY missing — knowledge module disabled",
      })
    );
  }
  return missing;
}
