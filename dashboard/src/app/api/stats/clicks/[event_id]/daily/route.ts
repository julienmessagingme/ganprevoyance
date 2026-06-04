import { NextResponse } from "next/server";
import { getSupabaseScoped } from "@/lib/supabase/service";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { getClicksDaily } from "@/lib/stats/daily";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ event_id: string }> }
) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const { event_id } = await ctx.params;
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (
    !from ||
    !to ||
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to)
  ) {
    return NextResponse.json({ error: "missing or bad from/to" }, { status: 400 });
  }
  const scope = await getCurrentSchoolSlugChecked();

  // L'event doit appartenir à l'école courante.
  const { data: ev } = await getSupabaseScoped(scope)
    .from("redirect_events")
    .select("school_slug")
    .eq("id", event_id)
    .maybeSingle();
  if (!ev || ev.school_slug !== scope) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const series = await getClicksDaily(event_id, from, to);
  return NextResponse.json({ series });
}
