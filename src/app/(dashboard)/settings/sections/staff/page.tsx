import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { SectionSettingsPage } from "@/components/settings/section-settings-page";

export const dynamic = "force-dynamic";

export default async function StaffSettingsSectionPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  return (
    <SectionSettingsPage session={session} section="staff" titleKey="settings_sections_staff" />
  );
}
