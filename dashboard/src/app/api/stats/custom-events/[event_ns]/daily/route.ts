import { NextResponse } from "next/server";
import { getCurrentSchoolSlugChecked } from "@/lib/schools/context";
import { requireUser } from "@/lib/auth/require-user";
import { getCustomEventDaily } from "@/lib/stats/daily";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ event_ns: string }> }
) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const { event_ns } = await ctx.params;
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
  const schoolSlug = await getCurrentSchoolSlugChecked();

  const series = await getCustomEventDaily(schoolSlug, event_ns, from, to);
  return NextResponse.json({ series });
}
