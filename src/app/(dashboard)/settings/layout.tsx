import type { ReactNode } from "react";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <DomainMessagesBoundary namespaces={["settingsUi", "masterUi", "reportsUi"]}>{children}</DomainMessagesBoundary>;
}
