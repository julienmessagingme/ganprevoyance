import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import {
  uploadToVectorStore,
  deleteOpenAIFile,
  deleteFromVectorStore,
} from "@/lib/openai-kb";
import { createTxtFromQA, buildQaFileName } from "@/lib/knowledge/file-gen";
import { findQaDuplicate, resolveThemeForSchool } from "@/lib/knowledge/qa-shared";

export const runtime = "nodejs";
export const maxDuration = 90;

const Body = z.object({
  question: z.string().trim().min(1).max(2000),
  answer: z.string().trim().min(1).max(20000),
  themeId: z.string().uuid().nullable().optional(),
  subthemeId: z.string().uuid().nullable().optional(),
  // skipIndexation : used by the bulk Excel import to avoid waiting 1-60s
  // per row. Not exposed to the UI.
  skipIndexation: z.boolean().optional(),
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

  const { question, answer, themeId, subthemeId, skipIndexation } = parsed.data;
  const schoolSlug = await getCurrentSchoolSlugChecked();

  // 1. Validate theme/subtheme ownership.
  const themeRes = await resolveThemeForSchool(
    schoolSlug,
    themeId ?? null,
    subthemeId ?? null
  );
  if (themeRes === null) {
    return NextResponse.json({ error: "invalid themeId or subthemeId" }, { status: 400 });
  }

  // 2. Duplicate check (per school, exact match on question or answer).
  const dup = await findQaDuplicate(schoolSlug, question, answer);
  if (dup.duplicate) {
    return NextResponse.json(
      {
        error: "duplicate",
        field: dup.field,
        message:
          dup.field === "question"
            ? "Une Q&R avec la même question existe déjà pour cette école."
            : "Une Q&R avec la même réponse existe déjà pour cette école.",
      },
      { status: 409 }
    );
  }

  // 3. Generate the .txt file.
  const txtBuffer = createTxtFromQA(
    question,
    answer,
    themeRes.themeName,
    themeRes.subthemeName
  );
  const fileName = buildQaFileName(question, themeRes.themeName, themeRes.subthemeName);

  // 4. Upload to OpenAI.
  let uploaded: { vectorStoreFileId: string; fileId: string; status: string };
  try {
    uploaded = await uploadToVectorStore(schoolSlug, txtBuffer, fileName, {
      skipIndexation: skipIndexation ?? false,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        action: "knowledge_upload_qa",
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

  // 5. Insert in DB.
  const sb = getSupabaseScoped(schoolSlug);
  const { data: item, error } = await sb
    .from("knowledge_items")
    .insert({
      school_slug: schoolSlug,
      type: "qa",
      file_name: fileName,
      question: question.trim(),
      answer: answer.trim(),
      theme_id: themeId ?? null,
      subtheme_id: subthemeId ?? null,
      vector_store_file_id: uploaded.vectorStoreFileId,
      openai_file_id: uploaded.fileId,
      status: uploaded.status,
      uploaded_by: user.userId,
    })
    .select(
      "id, type, file_name, question, answer, theme_id, subtheme_id, status, uploaded_at"
    )
    .single();

  if (error) {
    void deleteFromVectorStore(schoolSlug, uploaded.vectorStoreFileId).catch(
      () => undefined
    );
    void deleteOpenAIFile(uploaded.fileId).catch(() => undefined);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(
    JSON.stringify({
      level: "info",
      action: "knowledge_upload_qa",
      school: schoolSlug,
      item_id: item.id,
      user: user.userId,
    })
  );

  return NextResponse.json({ item });
}
