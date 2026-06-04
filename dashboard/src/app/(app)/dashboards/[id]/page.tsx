import { BuilderClient } from "./builder-client";
import { getCurrentSchoolSlug } from "@/lib/schools/context";

export default async function DashboardEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const schoolSlug = await getCurrentSchoolSlug();
  return <BuilderClient key={`${schoolSlug}-${id}`} dashboardId={id} />;
}
