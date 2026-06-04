import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { uploadToVectorStore, deleteOpenAIFile, deleteFromVectorStore } from "@/lib/openai-kb";
import { createPdfFromText, sanitizeFileName } from "@/lib/knowledge/file-gen";

export const runtime = "nodejs";
export const maxDuration = 90;

const Body = z.object({
  text: z.string().trim().min(1).max(200_000),
  title: z.string().trim().max(200).optional(),
});

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const title = parsed.data.title ?? "Document";

  // Build a PDF from the free-form text. pdf-lib is pure JS, runs fine in
  // the Alpine container.
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await createPdfFromText(parsed.data.text, title);
  } catch (err) {
    return NextResponse.json(
      {
        error: "pdf_generation_failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }

  const fileName = sanitizeFileName(`${title}.pdf`);

  let uploaded: { vectorStoreFileId: string; fileId: string; status: string };
  try {
    uploaded = await uploadToVectorStore(schoolSlug, pdfBuffer, fileName);
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        action: "knowledge_upload_text",
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
      type: "text",
      file_name: fileName,
      title,
      vector_store_file_id: uploaded.vectorStoreFileId,
      openai_file_id: uploaded.fileId,
      status: uploaded.status,
      uploaded_by: user.userId,
    })
    .select(
      "id, type, file_name, title, status, uploaded_at, vector_store_file_id, openai_file_id"
    )
    .single();

  if (error) {
    void deleteFromVectorStore(schoolSlug, uploaded.vectorStoreFileId).catch(
      () => undefined
    );
    void deleteOpenAIFile(uploaded.fileId).catch(() => undefined);
    console.error(
      JSON.stringify({
        level: "error",
        action: "knowledge_upload_text",
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
      action: "knowledge_upload_text",
      school: schoolSlug,
      item_id: item.id,
      title,
      user: user.userId,
    })
  );

  return NextResponse.json({ item });
}
