import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { PageHeader } from "@/components/ui/page-header";
import { KnowledgeDocumentsClient } from "@/components/knowledge/knowledge-documents-client";

export default async function KnowledgePage() {
  const session = await requireAuth();
  const t = await getTranslations("knowledgeUi.page");
  if (!hasCapability(session.user, "journals.view")) forbidden();
  // Пояс организации — для даты редакции «ППК NNN от …».
  const org = await db.organization.findUnique({ where: { id: getActiveOrgId(session) }, select: { timezone: true } });
  return <div className="space-y-6"><PageHeader title={t("title")} description={t("description")} /><KnowledgeDocumentsClient canManage={hasCapability(session.user, "admin.full")} timeZone={org?.timezone || "Europe/Moscow"} /></div>;
}
