import { DashboardsClient } from "./dashboards-client";
import { getCurrentSchoolSlug } from "@/lib/schools/context";

export default async function DashboardsPage() {
  const schoolSlug = await getCurrentSchoolSlug();
  return <DashboardsClient key={schoolSlug} />;
}
