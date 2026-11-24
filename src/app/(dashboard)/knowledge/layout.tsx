import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function KnowledgeLayout({ children }: { children: ReactNode }) {
  // productionControl — счётчик ознакомления, редакции «ППК NNN» и документы текстом (2026-11-24).
  return <DomainMessagesBoundary namespaces={["knowledgeUi", "productionControl"]}>{children}</DomainMessagesBoundary>;
}
