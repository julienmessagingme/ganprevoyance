import { z } from "zod";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { uploadToVectorStore, deleteFromVectorStore, deleteOpenAIFile } from "@/lib/openai-kb";
import { createTxtFromQA, buildQaFileName } from "@/lib/knowledge/file-gen";
import { findQaDuplicate } from "@/lib/knowledge/qa-shared";
import { pushKbItem, qaContent } from "@/lib/bot-kb";

export const runtime = "nodejs";
// Long-running bulk import — up to a few minutes for ~hundred lines.
export const maxDuration = 300;

const Body = z.object({
  pairs: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(2000),
        answer: z.string().trim().min(1).max(20000),
        theme: z.string().trim().max(120).optional(),
        subtheme: z.string().trim().max(120).optional(),
      })
    )
    .min(1)
    .max(2000),
});

const MAX_RETRIES = 3;

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Bulk Q&R import from a parsed Excel sheet. Body is expected to be a JSON
 * payload `{pairs: [...]}` — the .xlsx file itself is parsed client-side
 * by SheetJS so we never have to ship a binary file. Response is a
 * Server-Sent Events stream so the UI can render a progress bar.
 *
 * Flow :
 *   1. auto-create any new themes / subthemes from the input
 *   2. for each pair : upload (with retry), report success/failure
 *   3. emit a final 'done' event with the summary
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response("unauth", { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return new Response("invalid body", { status: 400 });
  }
  const { pairs } = parsed.data;
  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (data: object) => {
        controller.enqueue(encoder.encode(sseEvent(data)));
      };

      const summary = {
        total: pairs.length,
        successes: 0,
        failures: [] as { index: number; question: string; error: string }[],
        retries: [] as { index: number; question: string; attempts: number }[],
        createdThemes: [] as string[],
        createdSubthemes: [] as string[],
      };

      try {
        // Phase 1 : auto-create missing themes + subthemes for this school.
        const uniqueThemes = Array.from(
          new Set(pairs.map((p) => p.theme).filter((x): x is string => !!x))
        );
        const uniqueSubthemes = Array.from(
          new Set(pairs.map((p) => p.subtheme).filter((x): x is string => !!x))
        );

        const themeIdByName = new Map<string, string>();
        const subthemeIdByName = new Map<string, string>();

        for (const name of uniqueThemes) {
          const { data: existing } = await sb
            .from("knowledge_themes")
            .select("id")
            .eq("school_slug", schoolSlug)
            .eq("name", name)
            .maybeSingle();
          if (existing) {
            themeIdByName.set(name, existing.id);
            continue;
          }
          const { data: created, error } = await sb
            .from("knowledge_themes")
            .insert({ school_slug: schoolSlug, name })
            .select("id")
            .single();
          if (created) {
            themeIdByName.set(name, created.id);
            summary.createdThemes.push(name);
          } else if (error) {
            console.warn(
              JSON.stringify({
                level: "warn",
                msg: "knowledge_import_excel: theme create failed",
                name,
                err: error.message,
              })
            );
          }
        }

        for (const name of uniqueSubthemes) {
          const { data: existing } = await sb
            .from("knowledge_subthemes")
            .select("id")
            .eq("school_slug", schoolSlug)
            .eq("name", name)
            .maybeSingle();
          if (existing) {
            subthemeIdByName.set(name, existing.id);
            continue;
          }
          const { data: created, error } = await sb
            .from("knowledge_subthemes")
            .insert({ school_slug: schoolSlug, name })
            .select("id")
            .single();
          if (created) {
            subthemeIdByName.set(name, created.id);
            summary.createdSubthemes.push(name);
          } else if (error) {
            console.warn(
              JSON.stringify({
                level: "warn",
                msg: "knowledge_import_excel: subtheme create failed",
                name,
                err: error.message,
              })
            );
          }
        }

        if (summary.createdThemes.length > 0 || summary.createdSubthemes.length > 0) {
          send({
            type: "themes_created",
            createdThemes: summary.createdThemes,
            createdSubthemes: summary.createdSubthemes,
          });
        }

        // Phase 2 : upload each pair with retry.
        for (let i = 0; i < pairs.length; i++) {
          const pair = pairs[i];
          send({
            type: "progress",
            index: i,
            total: pairs.length,
            question: pair.question.substring(0, 80),
          });

          let succeeded = false;
          let lastError: string | null = null;

          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
              // Duplicate check — same logic as upload-qa, no point burning
              // an OpenAI call if we'll reject anyway.
              const dup = await findQaDuplicate(schoolSlug, pair.question, pair.answer);
              if (dup.duplicate) {
                throw new Error(
                  `Doublon : ${dup.field === "question" ? "question" : "réponse"} déjà présente`
                );
              }

              const themeId = pair.theme ? (themeIdByName.get(pair.theme) ?? null) : null;
              const subthemeId = pair.subtheme
                ? (subthemeIdByName.get(pair.subtheme) ?? null)
                : null;
              const txtBuffer = createTxtFromQA(
                pair.question,
                pair.answer,
                pair.theme ?? null,
                pair.subtheme ?? null
              );
              const fileName = buildQaFileName(
                pair.question,
                pair.theme ?? null,
                pair.subtheme ?? null
              );

              const uploaded = await uploadToVectorStore(
                schoolSlug,
                txtBuffer,
                fileName,
                { skipIndexation: true }
              );

              const { data: inserted, error } = await sb
                .from("knowledge_items")
                .insert({
                  school_slug: schoolSlug,
                  type: "qa",
                  file_name: fileName,
                  question: pair.question.trim(),
                  answer: pair.answer.trim(),
                  theme_id: themeId,
                  subtheme_id: subthemeId,
                  vector_store_file_id: uploaded.vectorStoreFileId,
                  openai_file_id: uploaded.fileId,
                  status: uploaded.status,
                  uploaded_by: user.userId,
                })
                .select("id")
                .single();
              if (error) {
                // DB insert failed AFTER the OpenAI upload succeeded. Roll
                // back the OpenAI side so we don't accumulate orphans, then
                // bail out of the retry loop : retrying would just upload
                // a fresh OpenAI file each time without ever fixing the
                // underlying DB issue. Mark as a "db_error" so the catch
                // below knows not to retry.
                void deleteFromVectorStore(schoolSlug, uploaded.vectorStoreFileId).catch(
                  () => undefined
                );
                void deleteOpenAIFile(uploaded.fileId).catch(() => undefined);
                throw new Error(`db_error: ${error.message}`);
              }

              // Alimente la KB du bot avec cette Q&R.
              await pushKbItem(inserted.id, {
                kind: "qa",
                title: pair.question.trim(),
                content: qaContent(pair.question.trim(), pair.answer.trim()),
              });

              succeeded = true;
              if (attempt > 1) {
                summary.retries.push({
                  index: i,
                  question: pair.question.substring(0, 80),
                  attempts: attempt,
                });
              }
              break;
            } catch (err) {
              lastError = err instanceof Error ? err.message : String(err);

              // Don't retry deterministic failures :
              //   - duplicates : retry will hit the same dup
              //   - db_error : OpenAI was already rolled back inside the
              //     try block, and another retry would just upload a new
              //     OpenAI file we'd have to roll back again
              if (lastError.startsWith("Doublon")) break;
              if (lastError.startsWith("db_error:")) break;

              if (attempt < MAX_RETRIES) {
                send({
                  type: "retry",
                  index: i,
                  total: pairs.length,
                  attempt,
                  maxRetries: MAX_RETRIES,
                  error: lastError,
                });
                await new Promise((res) => setTimeout(res, 1000 * attempt));
              }
            }
          }

          if (succeeded) {
            summary.successes++;
            send({
              type: "success",
              index: i,
              successes: summary.successes,
              failureCount: summary.failures.length,
            });
          } else {
            summary.failures.push({
              index: i,
              question: pair.question.substring(0, 80),
              error: lastError ?? "unknown error",
            });
            send({
              type: "failure",
              index: i,
              successes: summary.successes,
              failureCount: summary.failures.length,
              error: lastError ?? "unknown error",
            });
          }
        }

        send({ type: "done", summary });
        controller.close();
      } catch (err) {
        send({
          type: "fatal",
          error: err instanceof Error ? err.message : String(err),
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
