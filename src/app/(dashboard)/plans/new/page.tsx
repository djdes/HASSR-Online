import { getTranslations } from "next-intl/server";
import { requireAuth } from "@/lib/auth-helpers";
import { PlanForm } from "@/components/plans/plan-form";

export default async function NewPlanPage() {
  await requireAuth();
  const t = await getTranslations("productionPlans");
  return (
    <div className="space-y-5">
      <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold">{t("newTitle")}</h1>
      <PlanForm />
    </div>
  );
}
