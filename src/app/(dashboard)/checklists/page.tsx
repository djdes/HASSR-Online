import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { hasJournalAccess } from "@/lib/journal-acl";
import { CHECKLIST_CODE } from "@/lib/custom-checklists";
import { PageHeader } from "@/components/ui/page-header";
import { ChecklistsClient } from "@/components/checklists/checklists-client";

export default async function ChecklistsPage() {
  const session = await requireAuth();
  if (!(await hasJournalAccess(session.user, CHECKLIST_CODE))) notFound();
  return <div className="space-y-6"><PageHeader title="Конструктор чек-листов" description="Создавайте шаблоны, проводите проверки и сохраняйте результаты в журнале." /><ChecklistsClient /></div>;
}
