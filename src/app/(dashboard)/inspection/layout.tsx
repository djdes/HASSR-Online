import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function InspectionLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["inspectionDay", "reportsUi"]}>{children}</DomainMessagesBoundary>;
}
