import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function ControlBoardLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["controlBoardUi"]}>{children}</DomainMessagesBoundary>;
}
