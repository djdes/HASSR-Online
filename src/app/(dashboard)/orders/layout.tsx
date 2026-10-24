import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function OrdersLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["ordersUi"]}>{children}</DomainMessagesBoundary>;
}
