import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { NormDocumentsBody, NormDocumentsSanpinLink } from "@/components/production-control/norm-documents-body";

export const dynamic = "force-dynamic";

/** Нормативные документы: отметки каталога, свои документы, подписка на обновления и папка файлов. */
export default async function NormsDocumentsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);
  const t = await getTranslations("productionControl");

  return (
    <div className="space-y-6">
      <PpkBlockHeader blockKey="norm-documents" lead={t("norms.lead")} actions={<NormDocumentsSanpinLink />} />
      <NormDocumentsBody organizationId={organizationId} />
    </div>
  );
}
