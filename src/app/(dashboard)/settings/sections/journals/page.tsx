import { forbidden } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { SectionSettingsPage } from "@/components/settings/section-settings-page";

export const dynamic = "force-dynamic";

export default async function JournalSettingsSectionPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  return (
    <SectionSettingsPage session={session} section="journals" />
  );
}
