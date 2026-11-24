import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

/**
 * Раздел «Производственный контроль». Слот `modal` — окно пункта структуры ППК
 * (`@modal/(.)item/[id]`): ссылка пункта с обзора открывается поверх страницы,
 * прямой заход — страница `item/[id]`.
 */
export default function ProductionControlLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <DomainMessagesBoundary namespaces={["productionControl", "productionControlUi"]}>
      {children}
      {modal}
    </DomainMessagesBoundary>
  );
}
