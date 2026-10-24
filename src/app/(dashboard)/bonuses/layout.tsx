import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function BonusesLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["bonusesUi"]}>{children}</DomainMessagesBoundary>;
}
