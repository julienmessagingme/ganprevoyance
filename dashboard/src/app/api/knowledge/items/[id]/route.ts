import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import {
  deleteFromVectorStore,
  deleteOpenAIFile,
  uploadToVectorStore,
} from "@/lib/openai-kb";
import { createTxtFromQA, buildQaFileName } from "@/lib/knowledge/file-gen";
import { findQaDuplicate, resolveThemeForSchool } from "@/lib/knowledge/qa-shared";
import { pushKbItem, deleteKbItem, qaContent } from "@/lib/bot-kb";

export const runtime = "nodejs";
export const maxDuration = 90;

const PatchBody = z.object({
  question: z.string().trim().min(1).max(2000),
  answer: z.string().trim().min(1).max(20000),
  themeId: z.string().uuid().nullable().optional(),
  subthemeId: z.string().uuid().nullable().optional(),
});

/**
 * PATCH applies to Q&R items only. Since OpenAI's vector store API has no
 * "update" semantic, we delete-then-recreate : the old vector store entry
 * + file are removed, a freshly generated .txt is uploaded under the same
 * row, and the OpenAI ids on the row are swapped.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { question, answer, themeId, subthemeId } = parsed.data;

  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);

  const { data: item } = await sb
    .from("knowledge_items")
    .select("id, school_slug, type, vector_store_file_id, openai_file_id")
    .eq("id", id)
    .maybeSingle();
  if (!item || item.school_slug !== schoolSlug) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (item.type !== "qa") {
    return NextResponse.json(
      { error: "Seules les Q&R peuvent être modifiées en place. Pour un fichier ou un texte, supprimez puis recréez." },
      { status: 400 }
    );
  }

  // Validate theme/subtheme ownership.
  const themeRes = await resolveThemeForSchool(schoolSlug, themeId ?? null, subthemeId ?? null);
  if (themeRes === null) {
    return NextResponse.json({ error: "invalid themeId or subthemeId" }, { status: 400 });
  }

  // Duplicate check, excluding this item.
  const dup = await findQaDuplicate(schoolSlug, question, answer, id);
  if (dup.duplicate) {
    return NextResponse.json(
      {
        error: "duplicate",
        field: dup.field,
        message:
          dup.field === "question"
            ? "Une autre Q&R a déjà cette question."
            : "Une autre Q&R a déjà cette réponse.",
      },
      { status: 409 }
    );
  }

  // Generate the new .txt + upload to OpenAI.
  const txtBuffer = createTxtFromQA(question, answer, themeRes.themeName, themeRes.subthemeName);
  const fileName = buildQaFileName(question, themeRes.themeName, themeRes.subthemeName);

  let uploaded: { vectorStoreFileId: string; fileId: string; status: string };
  try {
    uploaded = await uploadToVectorStore(schoolSlug, txtBuffer, fileName);
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        action: "knowledge_item_patch",
        msg: "OpenAI upload of new version failed",
        item_id: id,
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

  // Update the row (atomically swap to the new OpenAI ids).
  const { error: updateError } = await sb
    .from("knowledge_items")
    .update({
      file_name: fileName,
      question: question.trim(),
      answer: answer.trim(),
      theme_id: themeId ?? null,
      subtheme_id: subthemeId ?? null,
      vector_store_file_id: uploaded.vectorStoreFileId,
      openai_file_id: uploaded.fileId,
      status: uploaded.status,
    })
    .eq("id", id);

  if (updateError) {
    // Roll back the new OpenAI upload so we don't leak.
    void deleteFromVectorStore(schoolSlug, uploaded.vectorStoreFileId).catch(() => undefined);
    void deleteOpenAIFile(uploaded.fileId).catch(() => undefined);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // Now clean up the OLD OpenAI artifacts. Failures here only log — the DB
  // is already in the new state, this is best-effort cleanup.
  if (item.vector_store_file_id) {
    void deleteFromVectorStore(item.school_slug, item.vector_store_file_id).catch((err) =>
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "knowledge_item_patch: old vector store delete failed",
          item_id: id,
          err: err instanceof Error ? err.message : String(err),
        })
      )
    );
  }
  if (item.openai_file_id) {
    void deleteOpenAIFile(item.openai_file_id).catch((err) =>
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "knowledge_item_patch: old openai file delete failed",
          item_id: id,
          err: err instanceof Error ? err.message : String(err),
        })
      )
    );
  }

  // Met à jour la KB du bot avec la nouvelle version de la Q&R.
  await pushKbItem(id, {
    kind: "qa",
    title: question.trim(),
    content: qaContent(question.trim(), answer.trim()),
  });

  console.log(
    JSON.stringify({
      level: "info",
      action: "knowledge_item_patch",
      school: schoolSlug,
      item_id: id,
    })
  );

  return NextResponse.json({ ok: true });
}

/**
 * DELETE removes the item from OpenAI (vector store + file) AND from the
 * DB. Failures on the OpenAI side are logged as warnings but do NOT block
 * the DB delete : we'd rather have a few orphan files in OpenAI than a
 * ghost row in the UI that can never be cleaned. A future cleanup job
 * (todo.md backlog) can reconcile.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);

  const { data: item } = await sb
    .from("knowledge_items")
    .select("id, school_slug, vector_store_file_id, openai_file_id")
    .eq("id", id)
    .maybeSingle();

  // 404 (not 403) so we don't leak existence of items in other schools.
  if (!item || item.school_slug !== schoolSlug) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (item.vector_store_file_id) {
    try {
      await deleteFromVectorStore(item.school_slug, item.vector_store_file_id);
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "knowledge_item_delete: vector_store delete failed",
          item_id: id,
          err: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }
  if (item.openai_file_id) {
    try {
      await deleteOpenAIFile(item.openai_file_id);
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: "warn",
          msg: "knowledge_item_delete: openai_file delete failed",
          item_id: id,
          err: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  const { error } = await sb.from("knowledge_items").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Retire l'entrée de la KB du bot.
  await deleteKbItem(id);

  console.log(
    JSON.stringify({
      level: "info",
      action: "knowledge_item_delete",
      school: schoolSlug,
      item_id: id,
    })
  );

  return NextResponse.json({ ok: true });
}
