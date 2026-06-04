import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { getVectorStoreFileStatus } from "@/lib/openai-kb";

export const runtime = "nodejs";

const Query = z.object({
  q: z.string().trim().optional(),
  type: z.enum(["file", "text", "qa"]).optional(),
  themeId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const SELECT_COLS =
  "id, type, file_name, title, question, answer, theme_id, subtheme_id, status, uploaded_at, uploaded_by, vector_store_file_id";

/**
 * Escapes user input before injecting into a supabase .or() filter. Commas
 * and parens have meaning in PostgREST's `or` syntax — without escaping a
 * search for "1,2" would be parsed as 2 filter clauses. The dot is also
 * a column-qualifier separator (`table.column`), so a search like "tarifs."
 * (with the trailing period found in any French question) would otherwise
 * produce a malformed query and a 400 from PostgREST.
 */
function escapeForOr(s: string): string {
  return s.replace(/[,()\\.]/g, "\\$&");
}

export async function GET(req: Request) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = Query.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    themeId: url.searchParams.get("themeId") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid query" }, { status: 400 });
  }

  const { q, type, themeId, page, limit } = parsed.data;
  const schoolSlug = await getCurrentSchoolSlugChecked();
  const sb = getSupabaseScoped(schoolSlug);
  const offset = (page - 1) * limit;

  let listQ = sb
    .from("knowledge_items")
    .select(SELECT_COLS, { count: "exact" })
    .eq("school_slug", schoolSlug)
    .order("uploaded_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (type) listQ = listQ.eq("type", type);
  if (themeId) listQ = listQ.eq("theme_id", themeId);

  if (q && q.length > 0) {
    // Use ilike across question/answer/title/file_name. Substring match
    // for queries >= 3 chars (catches "tarif" inside "Quels sont les tarifs ?"),
    // prefix-only for shorter queries to keep results sharp. The gin
    // tsvector index defined in migration 002 isn't usable from supabase-js
    // for an expression-based index — ilike on the same columns works for
    // the foreseeable scale (a few thousand items per school).
    const safe = escapeForOr(q);
    const filter =
      q.length >= 3
        ? `question.ilike.%${safe}%,answer.ilike.%${safe}%,title.ilike.%${safe}%,file_name.ilike.%${safe}%`
        : `question.ilike.${safe}%,title.ilike.${safe}%,file_name.ilike.${safe}%`;
    listQ = listQ.or(filter);
  }

  const { data: items, count, error } = await listQ;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Lazy reconcile of stuck indexation statuses : the upload-time poll
  // bails after 60 s and persists whatever status OpenAI reported (often
  // `in_progress` for larger or slower files). Nothing else writes back
  // afterwards, so the badge would stay "Indexation en cours" forever.
  // Here we re-fetch the real status for any non-terminal row in the
  // current page and update the DB in place. Best-effort : a single
  // failed call must not break the listing. Bounded by `limit` (≤ 100).
  const stuck = (items ?? []).filter(
    (i) =>
      i.vector_store_file_id &&
      i.status !== "completed" &&
      i.status !== "failed"
  );
  if (stuck.length > 0) {
    await Promise.all(
      stuck.map(async (it) => {
        try {
          const real = await getVectorStoreFileStatus(
            schoolSlug,
            it.vector_store_file_id as string
          );
          // If file no longer exists in the vector store, flip to `failed`
          // so the row stops polling. The user can delete it from the UI.
          const next = real ?? "failed";
          if (next !== it.status) {
            await sb
              .from("knowledge_items")
              .update({ status: next })
              .eq("id", it.id);
            it.status = next;
          }
        } catch (err) {
          console.warn(
            JSON.stringify({
              level: "warn",
              msg: "knowledge_items_reconcile: status check failed",
              item_id: it.id,
              err: err instanceof Error ? err.message : String(err),
            })
          );
        }
      })
    );
  }

  // Resolve theme + subtheme names in two batched roundtrips.
  const themeIds = Array.from(
    new Set((items ?? []).map((i) => i.theme_id).filter((x): x is string => !!x))
  );
  const subthemeIds = Array.from(
    new Set((items ?? []).map((i) => i.subtheme_id).filter((x): x is string => !!x))
  );

  const [themes, subthemes] = await Promise.all([
    themeIds.length > 0
      ? sb
          .from("knowledge_themes")
          .select("id, name")
          .in("id", themeIds)
          .then((r) => r.data ?? [])
      : Promise.resolve([] as { id: string; name: string }[]),
    subthemeIds.length > 0
      ? sb
          .from("knowledge_subthemes")
          .select("id, name")
          .in("id", subthemeIds)
          .then((r) => r.data ?? [])
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const themeName = new Map(themes.map((t) => [t.id, t.name]));
  const subthemeName = new Map(subthemes.map((s) => [s.id, s.name]));

  const enriched = (items ?? []).map((it) => ({
    ...it,
    theme_name: it.theme_id ? (themeName.get(it.theme_id) ?? null) : null,
    subtheme_name: it.subtheme_id ? (subthemeName.get(it.subtheme_id) ?? null) : null,
  }));

  const total = count ?? 0;
  return NextResponse.json({
    items: enriched,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
    hasMore: offset + (items?.length ?? 0) < total,
  });
}
