import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function LossesLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["productionLosses"]}>{children}</DomainMessagesBoundary>;
}
