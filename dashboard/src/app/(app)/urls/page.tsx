import { UrlsClient } from "./urls-client";
import { env } from "@/lib/env";
import { getCurrentSchoolSlug } from "@/lib/schools/context";

export default async function UrlsPage() {
  const schoolSlug = await getCurrentSchoolSlug();
  return <UrlsClient key={schoolSlug} publicBaseUrl={env.publicBaseUrl} />;
}
