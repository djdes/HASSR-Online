import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function JournalsProgressLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["journalsProgressUi"]}>{children}</DomainMessagesBoundary>;
}
