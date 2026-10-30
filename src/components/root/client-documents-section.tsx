import { getServerSession } from "next-auth";

import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { authOptions } from "@/lib/auth";
import { loadClientDocumentsContext } from "@/lib/client-documents.server";

import { ClientContractSection } from "./client-contract-section";
import { ClientDocumentsPanel } from "./client-documents-panel";

/**
 * Раздел «Документы клиенту» карточки клиента: плитки договора, КП и счёта
 * и под ними — карточка договора. Страница вставляет его одной строкой.
 */
export async function ClientDocumentsSection({ organizationId, edo = false }: { organizationId: string; edo?: boolean }) {
  const session = await getServerSession(authOptions);
  const context = session ? await loadClientDocumentsContext(organizationId, session) : null;
  return (
    <div className="space-y-4">
      {context ? (
        <DomainMessagesBoundary namespaces={["rootClientDocuments"]}>
          <ClientDocumentsPanel initial={context} />
        </DomainMessagesBoundary>
      ) : null}
      <div id="client-contract" className="scroll-mt-16">
        <ClientContractSection organizationId={organizationId} edo={edo} />
      </div>
    </div>
  );
}
