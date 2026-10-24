import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function ProductionControlLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["productionControl", "productionControlUi"]}>{children}</DomainMessagesBoundary>;
}
