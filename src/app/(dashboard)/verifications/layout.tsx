import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function VerificationsLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["verificationsUi"]}>{children}</DomainMessagesBoundary>;
}
