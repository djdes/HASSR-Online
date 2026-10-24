import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function InspectorLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["inspectorUi"]}>{children}</DomainMessagesBoundary>;
}
