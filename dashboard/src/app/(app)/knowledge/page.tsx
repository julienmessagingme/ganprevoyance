import { KnowledgeClient } from "./knowledge-client";
import { getCurrentSchoolSlug } from "@/lib/schools/context";
import { getSchoolBySlug } from "@/lib/schools";

export default async function KnowledgePage() {
  const schoolSlug = await getCurrentSchoolSlug();
  const school = getSchoolBySlug(schoolSlug);
  return <KnowledgeClient schoolName={school?.name ?? schoolSlug} />;
}
