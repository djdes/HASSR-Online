import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { loadContractContext } from "@/lib/contracts/service.server";

import { ClientContractCard } from "./client-contract-card";

/**
 * Серверная обёртка карточки договора для ROOT-страницы организации:
 * грузит готовность, значения формы и историю, отдаёт свои переводы.
 * Страница вставляет её одной строкой — остальное живёт здесь.
 */
export async function ClientContractSection({ organizationId }: { organizationId: string }) {
  const context = await loadContractContext(organizationId);
  return (
    <DomainMessagesBoundary namespaces={["rootClientContract"]}>
      <ClientContractCard initial={context} />
    </DomainMessagesBoundary>
  );
}
