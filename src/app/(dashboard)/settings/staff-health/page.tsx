import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { MedBooksExpiryCard } from "@/components/dashboard/med-books-expiry-card";
import { StaffTrainingCard } from "@/components/dashboard/staff-training-card";

export const dynamic = "force-dynamic";

/**
 * «Сотрудники → Медкнижки»: сроки медкнижек и обучение. Раньше эти
 * блоки жили на главной и терялись среди журналов.
 */
export default async function StaffHealthPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const tRoutes = await getTranslations("navigation.routes");
  return (
    <div className="space-y-5">
      <h1 className="sr-only">{tRoutes("settings_staff_health")}</h1>
      <MedBooksExpiryCard />
      <StaffTrainingCard />
    </div>
  );
}
