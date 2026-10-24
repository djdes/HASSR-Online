import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function ChecklistsLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["checklistsUi"]}>{children}</DomainMessagesBoundary>;
}
