import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function ChangesLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["changeManagement"]}>{children}</DomainMessagesBoundary>;
}
