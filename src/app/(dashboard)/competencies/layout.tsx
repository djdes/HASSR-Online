import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function CompetenciesLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["competenciesManagement"]}>{children}</DomainMessagesBoundary>;
}
