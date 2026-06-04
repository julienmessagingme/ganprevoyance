import { StatsClient } from "./stats-client";
import { getCurrentSchoolSlug } from "@/lib/schools/context";

export default async function StatsPage() {
  const schoolSlug = await getCurrentSchoolSlug();
  return <StatsClient key={schoolSlug} />;
}
