import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth } from "@/lib/auth-helpers";
import { hasJournalAccess } from "@/lib/journal-acl";
import { CHECKLIST_CODE } from "@/lib/custom-checklists";
import { PageHeader } from "@/components/ui/page-header";
import { ChecklistsClient } from "@/components/checklists/checklists-client";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default async function ChecklistsPage() {
  const session = await requireAuth();
  if (!(await hasJournalAccess(session.user, CHECKLIST_CODE))) notFound();
  const t = await getTranslations("checklistsUi.checklistsPage");
  return <div className="space-y-6"><PageHeader title={t("title")} description={t("description")} /><DomainMessagesBoundary namespaces={["checklistPages", "checklistsUi"]}><ChecklistsClient /></DomainMessagesBoundary></div>;
}
