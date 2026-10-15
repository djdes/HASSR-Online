import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function CapaLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["capaManagement"]}>{children}</DomainMessagesBoundary>;
}
