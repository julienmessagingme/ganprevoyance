import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import path from "node:path";

config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function upsertAdmin(email: string, name: string, password: string) {
  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await sb
    .from("users")
    .upsert(
      { email, name, password_hash, is_admin: true },
      { onConflict: "email" }
    )
    .select("id")
    .single();
  if (error) throw error;
  if (!data?.id) throw new Error(`no id returned for ${email}`);

  const { error: accessErr } = await sb
    .from("user_school_access")
    .upsert(
      { user_id: data.id, school_slug: "gan-prev" },
      { onConflict: "user_id,school_slug" }
    );
  if (accessErr) throw accessErr;

  console.log(`✓ ${email} (admin, accès gan-prev)`);
}

async function main() {
  const julienPwd = process.env.SEED_JULIEN_PASSWORD;
  if (!julienPwd) {
    console.error("Set SEED_JULIEN_PASSWORD env var before running");
    process.exit(1);
  }
  await upsertAdmin("julien@messagingme.fr", "Julien Dumas", julienPwd);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
