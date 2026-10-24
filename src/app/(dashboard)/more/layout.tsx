import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function MoreLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["moreUi"]}>{children}</DomainMessagesBoundary>;
}
