import { NextResponse } from "next/server";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { uploadToVectorStore, deleteOpenAIFile, deleteFromVectorStore } from "@/lib/openai-kb";
import { sanitizeFileName } from "@/lib/knowledge/file-gen";
import {
  validateUpload,
  ACCEPTED_FILE_EXTS,
  MAX_FILE_BYTES,
} from "@/lib/knowledge/validate";

export const runtime = "nodejs";
// Knowledge uploads can take 30-60s while OpenAI indexes the file. The
// Vercel default of 10s would cut us off mid-upload ; on our self-hosted
// VPS this just hints at the expected duration.
export const maxDuration = 90;

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const schoolSlug = await getCurrentSchoolSlugChecked();

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "empty file" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "file too large (max 10 MB)" }, { status: 413 });
  }

  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!ACCEPTED_FILE_EXTS.includes(ext as (typeof ACCEPTED_FILE_EXTS)[number])) {
    return NextResponse.json(
      { error: `extension ".${ext}" non supportée — accepté: ${ACCEPTED_FILE_EXTS.join(", ")}` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const validationError = validateUpload(ext, buffer);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const cleanName = sanitizeFileName(file.name);

  // Upload to OpenAI first. If the DB insert later fails, we'll attempt to
  // roll back the OpenAI side so we don't leave orphan files in the vector
  // store.
  let uploaded: { vectorStoreFileId: string; fileId: string; status: string };
  try {
    uploaded = await uploadToVectorStore(schoolSlug, buffer, cleanName);
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        action: "knowledge_upload_file",
        msg: "OpenAI upload failed",
        school: schoolSlug,
        err: err instanceof Error ? err.message : String(err),
      })
    );
    return NextResponse.json(
      {
        error: "openai_upload_failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  const sb = getSupabaseScoped(schoolSlug);
  const { data: item, error } = await sb
    .from("knowledge_items")
    .insert({
      school_slug: schoolSlug,
      type: "file",
      file_name: cleanName,
      vector_store_file_id: uploaded.vectorStoreFileId,
      openai_file_id: uploaded.fileId,
      status: uploaded.status,
      uploaded_by: user.userId,
    })
    .select(
      "id, type, file_name, status, uploaded_at, vector_store_file_id, openai_file_id"
    )
    .single();

  if (error) {
    // DB insert failed AFTER the OpenAI upload succeeded. Try to roll back
    // OpenAI to avoid an orphan. Ignore failures here — we logged.
    void deleteFromVectorStore(schoolSlug, uploaded.vectorStoreFileId).catch(
      () => undefined
    );
    void deleteOpenAIFile(uploaded.fileId).catch(() => undefined);

    console.error(
      JSON.stringify({
        level: "error",
        action: "knowledge_upload_file",
        msg: "DB insert failed after OpenAI upload — attempted rollback",
        school: schoolSlug,
        err: error.message,
      })
    );
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(
    JSON.stringify({
      level: "info",
      action: "knowledge_upload_file",
      school: schoolSlug,
      item_id: item.id,
      file_name: cleanName,
      user: user.userId,
    })
  );

  return NextResponse.json({ item });
}
