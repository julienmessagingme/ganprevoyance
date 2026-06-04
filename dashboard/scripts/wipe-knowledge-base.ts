/**
 * One-shot wipe of all knowledge base content across all 9 schools.
 *
 *  1. Counts current items per school (DB + OpenAI vector store)
 *  2. For every knowledge_items row : deletes the vector store file and the
 *     underlying OpenAI Files API file (using the ids stored on the row)
 *  3. Lists each vector store for orphans not referenced in DB, deletes those
 *     too (vector store file id + best-effort file id from the VS payload)
 *  4. DELETE FROM knowledge_items for every school
 *
 *  Themes / subthemes are NOT touched — the taxonomy stays.
 *
 *  Run with :   npx tsx scripts/wipe-knowledge-base.ts
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import path from "node:path";
import OpenAI from "openai";

config({ path: path.resolve(process.cwd(), ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !OPENAI_KEY) {
  console.error("Missing env (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY).");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const openai = new OpenAI({ apiKey: OPENAI_KEY });

const SCHOOLS = [
  { slug: "efap", vsEnv: "OPENAI_VS_EFAP" },
  { slug: "3wa", vsEnv: "OPENAI_VS_3WA" },
  { slug: "brassart", vsEnv: "OPENAI_VS_BRASSART" },
  { slug: "cesine", vsEnv: "OPENAI_VS_CESINE" },
  { slug: "efj", vsEnv: "OPENAI_VS_EFJ" },
  { slug: "esec", vsEnv: "OPENAI_VS_ESEC" },
  { slug: "ecole-bleue", vsEnv: "OPENAI_VS_ECOLE_BLEUE" },
  { slug: "icart", vsEnv: "OPENAI_VS_ICART" },
  { slug: "ifa", vsEnv: "OPENAI_VS_IFA" },
];

const VS_BASE = "https://api.openai.com/v1/vector_stores";
const headers = {
  Authorization: `Bearer ${OPENAI_KEY}`,
  "OpenAI-Beta": "assistants=v2",
};

async function listAllVsFiles(vsId: string): Promise<{ id: string; file_id?: string }[]> {
  const out: { id: string; file_id?: string }[] = [];
  let after: string | undefined;
  for (;;) {
    const url = new URL(`${VS_BASE}/${vsId}/files`);
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`list VS files ${vsId}: HTTP ${r.status} — ${await r.text().catch(() => "")}`);
    const j = (await r.json()) as { data: { id: string; file_id?: string }[]; has_more: boolean; last_id?: string };
    out.push(...j.data);
    if (!j.has_more) break;
    after = j.last_id;
  }
  return out;
}

async function deleteVsFile(vsId: string, vsFileId: string): Promise<boolean> {
  const r = await fetch(`${VS_BASE}/${vsId}/files/${vsFileId}`, { method: "DELETE", headers });
  if (!r.ok && r.status !== 404) {
    console.warn(`  ! VS delete failed ${vsFileId}: HTTP ${r.status}`);
    return false;
  }
  return true;
}

async function deleteFile(fileId: string): Promise<boolean> {
  try {
    await openai.files.delete(fileId);
    return true;
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return true;
    console.warn(`  ! Files API delete failed ${fileId}: ${e.message ?? err}`);
    return false;
  }
}

async function main() {
  console.log("=== WIPE KNOWLEDGE BASE — start ===\n");

  let totalDbRows = 0;
  let totalVsFilesDeleted = 0;
  let totalFilesDeleted = 0;

  for (const school of SCHOOLS) {
    const vsId = process.env[school.vsEnv];
    if (!vsId) {
      console.log(`[${school.slug}] no ${school.vsEnv} configured — skipping VS clean`);
    }
    console.log(`\n--- ${school.slug.toUpperCase()} (vs ${vsId ?? "—"}) ---`);

    const { data: rows, error } = await sb
      .from("knowledge_items")
      .select("id, vector_store_file_id, openai_file_id")
      .eq("school_slug", school.slug);
    if (error) throw error;

    console.log(`  DB rows         : ${rows?.length ?? 0}`);
    totalDbRows += rows?.length ?? 0;

    if (vsId) {
      const vsFiles = await listAllVsFiles(vsId);
      console.log(`  VS files listed : ${vsFiles.length}`);

      // Build the union of (VS file ids) ∪ (ids from DB rows) to be safe.
      const vsFileIds = new Set<string>(vsFiles.map((f) => f.id));
      const fileIds = new Set<string>(vsFiles.map((f) => f.file_id).filter((x): x is string => !!x));
      for (const row of rows ?? []) {
        if (row.vector_store_file_id) vsFileIds.add(row.vector_store_file_id);
        if (row.openai_file_id) fileIds.add(row.openai_file_id);
      }

      for (const id of vsFileIds) {
        const ok = await deleteVsFile(vsId, id);
        if (ok) totalVsFilesDeleted++;
      }
      console.log(`  VS files deleted: ${vsFileIds.size}`);

      for (const id of fileIds) {
        const ok = await deleteFile(id);
        if (ok) totalFilesDeleted++;
      }
      console.log(`  Files deleted   : ${fileIds.size}`);
    }

    const { error: delErr, count } = await sb
      .from("knowledge_items")
      .delete({ count: "exact" })
      .eq("school_slug", school.slug);
    if (delErr) throw delErr;
    console.log(`  DB deleted      : ${count ?? 0}`);
  }

  console.log("\n=== SUMMARY ===");
  console.log(`  DB rows wiped    : ${totalDbRows}`);
  console.log(`  VS files deleted : ${totalVsFilesDeleted}`);
  console.log(`  Files deleted    : ${totalFilesDeleted}`);
  console.log("\n=== WIPE KNOWLEDGE BASE — done ===");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
