// Next.js 15 instrumentation hook : runs once when the server boots.
// Used to bootstrap the daily cron and surface missing config early.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { warnMissingSchoolTokens } = await import("@/lib/schools");
  warnMissingSchoolTokens();

  if (process.env.DISABLE_CRON === "1") {
    console.log(
      JSON.stringify({ level: "info", msg: "cron disabled (DISABLE_CRON=1)" })
    );
    return;
  }

  // node-cron uses CJS internals (worker_threads, stream) that webpack
  // can't bundle into the instrumentation chunk. We side-step the bundler
  // by hiding the module specs behind runtime-resolved strings : webpack's
  // static analysis can't see a literal "module" or "node-cron" reference,
  // so it leaves both as runtime requires. createRequire works in both CJS
  // (dev) and ESM (production standalone), unlike eval('require') which
  // fails in ESM.
  const moduleSpec = ["m", "o", "d", "u", "l", "e"].join("");
  const cronSpec = ["node", "-", "cron"].join("");
  const { createRequire } = (await import(
    /* webpackIgnore: true */ moduleSpec
  )) as typeof import("module");
  const nodeRequire = createRequire(import.meta.url);
  const cron = nodeRequire(cronSpec) as typeof import("node-cron");

  const { syncAllSchools } = await import("@/lib/messagingme/sync");
  const { env } = await import("@/lib/env");

  cron.schedule(
    "0 22 * * *",
    async () => {
      console.log(
        JSON.stringify({ level: "info", msg: "cron tick: syncAllSchools start" })
      );
      try {
        const r = await syncAllSchools();
        console.log(
          JSON.stringify({
            level: "info",
            msg: "syncAllSchools done",
            ...r,
          })
        );
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            msg: "syncAllSchools fatal",
            err: err instanceof Error ? err.message : String(err),
          })
        );
      }
    },
    { timezone: env.cronTimezone }
  );

  console.log(
    JSON.stringify({
      level: "info",
      msg: "cron scheduled",
      schedule: "0 22 * * *",
      timezone: env.cronTimezone,
    })
  );
}
