import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function MiniTodayLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["miniToday", "miniTaskPool"]}>{children}</DomainMessagesBoundary>;
}
