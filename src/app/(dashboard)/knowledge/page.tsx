import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { PageHeader } from "@/components/ui/page-header";
import { KnowledgeDocumentsClient } from "@/components/knowledge/knowledge-documents-client";

export default async function KnowledgePage() {
  const session = await requireAuth();
  if (!hasCapability(session.user, "journals.view")) redirect("/dashboard");
  return <div className="space-y-6"><PageHeader title="База знаний — документация" description="Инструкции, сканы и рабочие документы вашей организации." /><KnowledgeDocumentsClient canManage={hasCapability(session.user, "admin.full")} /></div>;
}
