import { forbidden } from "next/navigation";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { CommissionPageClient } from "@/components/staff/commission-page-client";

export const dynamic = "force-dynamic";

/** Журналы с бракеражной комиссией — порядок карточек на странице. */
const COMMISSION_JOURNALS = ["finished_product", "perishable_rejection"] as const;

/**
 * «Бракеражная комиссия» — состав комиссии обоих бракеражных журналов
 * (готовой и скоропортящейся продукции) на одной странице. Состав читает и
 * меняет `/api/settings/brakerage-commission/<code>` (окно «Комиссия» из
 * документа журнала); сохранение копирует состав в действующие документы.
 */
export default async function BrakerageCommissionPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { disabledJournalCodes: true },
  });
  const disabled = parseDisabledCodes(organization?.disabledJournalCodes);

  return (
    <DomainMessagesBoundary namespaces={["staffPages"]}>
      <CommissionPageClient
        journals={COMMISSION_JOURNALS.map((code) => ({ code, enabled: !disabled.has(code) }))}
      />
    </DomainMessagesBoundary>
  );
}
