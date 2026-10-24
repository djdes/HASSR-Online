import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function TeamLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["teamUi"]}>{children}</DomainMessagesBoundary>;
}
