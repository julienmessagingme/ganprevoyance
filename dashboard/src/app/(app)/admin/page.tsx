import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-user";
import { AdminClient } from "./admin-client";

export default async function AdminPage() {
  try {
    const me = await requireAdmin();
    return <AdminClient meId={me.userId} />;
  } catch {
    notFound();
  }
}
