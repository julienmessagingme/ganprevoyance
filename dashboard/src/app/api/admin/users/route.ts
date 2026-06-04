import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getSupabase } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/auth/require-user";
import { DEFAULT_SCHOOL_SLUG, isValidSchoolSlug } from "@/lib/schools";
import type { AdminUser } from "@/lib/admin/types";

export const runtime = "nodejs";

const PostBody = z.object({
  email: z.string().email().toLowerCase(),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(8).max(200),
  is_admin: z.boolean(),
  schools: z.array(z.string()).default([]),
});

export async function GET() {
  try {
    await requireAdmin();
  } catch (e) {
    const status = (e as { status?: number }).status ?? 401;
    return NextResponse.json({ error: "forbidden" }, { status });
  }

  // DB partagée avec d'autres apps (EDH). On ne liste QUE les utilisateurs
  // qui ont un accès `user_school_access` à l'école Gan Prévoyance — sinon on verrait
  // tous les comptes EDH.
  const sb = getSupabase();
  const { data: access, error: aErr } = await sb
    .from("user_school_access")
    .select("user_id")
    .eq("school_slug", DEFAULT_SCHOOL_SLUG);
  if (aErr)
    return NextResponse.json({ error: aErr.message }, { status: 500 });
  const allowedIds = Array.from(
    new Set(
      ((access ?? []) as { user_id: string }[]).map((r) => r.user_id)
    )
  );
  if (allowedIds.length === 0) {
    return NextResponse.json({ users: [] });
  }

  const { data: users, error: uErr } = await sb
    .from("users")
    .select("id, email, name, is_admin, deactivated_at, last_login_at, created_at")
    .in("id", allowedIds)
    .order("created_at", { ascending: true });
  if (uErr)
    return NextResponse.json({ error: uErr.message }, { status: 500 });

  const out: AdminUser[] = ((users ?? []) as AdminUser[]).map((u) => ({
    ...u,
    schools: [DEFAULT_SCHOOL_SLUG],
  }));
  return NextResponse.json({ users: out });
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch (e) {
    const status = (e as { status?: number }).status ?? 401;
    return NextResponse.json({ error: "forbidden" }, { status });
  }

  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { email, name, password, is_admin, schools } = parsed.data;
  const validSchools = schools.filter(isValidSchoolSlug);

  const sb = getSupabase();
  const passwordHash = await bcrypt.hash(password, 10);

  const { data: created, error: insErr } = await sb
    .from("users")
    .insert({
      email,
      name,
      password_hash: passwordHash,
      is_admin,
    })
    .select("id")
    .single();
  if (insErr) {
    if ((insErr as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "duplicate", message: "Cet email existe déjà." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  if (validSchools.length > 0) {
    const { error: aErr } = await sb.from("user_school_access").insert(
      validSchools.map((s) => ({
        user_id: created.id,
        school_slug: s,
      }))
    );
    if (aErr)
      return NextResponse.json({ error: aErr.message }, { status: 500 });
  }

  return NextResponse.json({ id: created.id });
}
