import { CampaignPageClient } from "./campaign-page-client";
import { getCurrentSchoolSlug } from "@/lib/schools/context";

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const schoolSlug = await getCurrentSchoolSlug();
  return <CampaignPageClient key={`${schoolSlug}:${id}`} campaignId={id} />;
}
