import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

/**
 * Страницы ознакомления сотрудника: кнопке «Ознакомлен(а)» нужны тексты
 * `acknowledge`, полю подписи пальцем (лист 3.7) — `productionControl`.
 */
export default function AcknowledgeLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["acknowledge", "productionControl"]}>{children}</DomainMessagesBoundary>;
}
