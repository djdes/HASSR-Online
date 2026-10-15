import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function PlansLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["productionPlans"]}>{children}</DomainMessagesBoundary>;
}
