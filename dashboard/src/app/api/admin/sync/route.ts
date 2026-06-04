import { NextResponse } from "next/server";
import { syncAllSchools } from "@/lib/messagingme/sync";
import { requireUser } from "@/lib/auth/require-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Session-authenticated alternative to /api/cron/sync — this is the one
// the Stats UI calls. We don't expose INTERNAL_API_KEY to the browser,
// so the UI proxies through this endpoint which only requires a valid
// session cookie.
export async function POST() {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const r = await syncAllSchools();
  return NextResponse.json({ success: true, result: r });
}
