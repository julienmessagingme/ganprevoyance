import { CampaignsClient } from "./campaigns-client";
import { getCurrentSchoolSlug } from "@/lib/schools/context";

export default async function CampaignsPage() {
  const schoolSlug = await getCurrentSchoolSlug();
  return <CampaignsClient key={schoolSlug} />;
}
