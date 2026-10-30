import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { MedBooksExpiryCard } from "@/components/dashboard/med-books-expiry-card";
import { StaffTrainingCard } from "@/components/dashboard/staff-training-card";
import { SectionPageHeader } from "@/components/layout/section-page-header";

export const dynamic = "force-dynamic";

/**
 * «Сотрудники → Медкнижки»: сроки медкнижек и обучение. Раньше эти
 * блоки жили на главной и терялись среди журналов.
 */
export default async function StaffHealthPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const tRoutes = await getTranslations("navigation.routes");
  const tLeads = await getTranslations("navigation.shell.leads");
  return (
    <div className="space-y-5">
      <SectionPageHeader title={tRoutes("settings_staff_health")} description={tLeads("staffHealth")} />
      <MedBooksExpiryCard />
      <StaffTrainingCard />
    </div>
  );
}
