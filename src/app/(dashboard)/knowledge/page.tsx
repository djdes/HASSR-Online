import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { PageHeader } from "@/components/ui/page-header";
import { KnowledgeDocumentsClient } from "@/components/knowledge/knowledge-documents-client";

export default async function KnowledgePage() {
  const session = await requireAuth();
  const t = await getTranslations("knowledgeUi.page");
  if (!hasCapability(session.user, "journals.view")) forbidden();
  return <div className="space-y-6"><PageHeader title={t("title")} description={t("description")} /><KnowledgeDocumentsClient canManage={hasCapability(session.user, "admin.full")} /></div>;
}
