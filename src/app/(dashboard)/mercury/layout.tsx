import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function MercuryLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["mercuryUi"]}>{children}</DomainMessagesBoundary>;
}
