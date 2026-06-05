import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireUser } from "@/lib/auth/require-user";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { listKbSources, getKbSource, upsertKbSource, deleteKbSource } from "@/lib/bot-kb";

export const runtime = "nodejs";
export const maxDuration = 90;

async function gate(): Promise<boolean> {
  try {
    await requireUser();
    await getCurrentSchoolSlugChecked(); // garantit l'accès à l'école courante
    return true;
  } catch {
    return false;
  }
}

// GET /api/knowledge/kb            -> liste des sources de la KB du bot
// GET /api/knowledge/kb?url=...    -> contenu complet d'une source (édition)
export async function GET(req: Request) {
  if (!(await gate())) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const url = params.get("url");
  const q = params.get("q") || "";
  try {
    if (url) {
      const source = await getKbSource(url);
      if (!source) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ source });
    }
    return NextResponse.json({ sources: await listKbSources(q) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

const PostBody = z.object({
  url: z.string().trim().min(1).optional(), // présent = édition d'une source existante
  title: z.string().trim().max(300).optional(),
  content: z.string().trim().min(1).max(200_000),
});

// POST /api/knowledge/kb -> crée (sans url) ou met à jour (avec url) une source.
export async function POST(req: Request) {
  if (!(await gate())) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  const { url, title, content } = parsed.data;
  try {
    if (url) {
      const r = await upsertKbSource({ url, title: title ?? null, kind: "manuel", content });
      return NextResponse.json({ ok: true, url, ...r });
    }
    const sourceId = nanoid();
    const r = await upsertKbSource({ sourceId, title: title ?? null, kind: "manuel", content });
    return NextResponse.json({ ok: true, url: `kb://${sourceId}`, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

// DELETE /api/knowledge/kb?url=... -> supprime une source.
export async function DELETE(req: Request) {
  if (!(await gate())) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const url = new URL(req.url).searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url requise" }, { status: 400 });
  try {
    const r = await deleteKbSource(url);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
