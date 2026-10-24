import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function IdeasLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["ideasUi"]}>{children}</DomainMessagesBoundary>;
}
