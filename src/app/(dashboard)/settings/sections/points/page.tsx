import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { SectionSettingsPage } from "@/components/settings/section-settings-page";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { PrintAgentCard } from "@/components/dashboard/print-agent-card";

export const dynamic = "force-dynamic";

export default async function PointSettingsSectionPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  return (
    <SectionSettingsPage session={session} section="points" titleKey="settings_sections_points">
      <DomainMessagesBoundary namespaces={["printAgent"]}>
        <PrintAgentCard />
      </DomainMessagesBoundary>
    </SectionSettingsPage>
  );
}
