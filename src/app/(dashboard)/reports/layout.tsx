import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["reports"]}>{children}</DomainMessagesBoundary>;
}
