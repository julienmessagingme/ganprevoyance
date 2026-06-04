function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

// Lazy getters : env vars are only validated when actually accessed at
// runtime, not at module load time. This is critical for `next build` to
// succeed inside Docker, where no .env is present at build time but is
// supplied at runtime via env_file.
export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL");
  },
  get supabaseServiceKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get authSecret() {
    return required("AUTH_SECRET");
  },
  get internalApiKey() {
    return required("INTERNAL_API_KEY");
  },
  get messagingmeBase() {
    return process.env.MESSAGINGME_API_BASE ?? "https://ai.messagingme.app/api";
  },
  get cronTimezone() {
    return process.env.CRON_TIMEZONE ?? "Europe/Paris";
  },
  get publicBaseUrl() {
    return process.env.PUBLIC_BASE_URL ?? "http://localhost:3000";
  },
};
