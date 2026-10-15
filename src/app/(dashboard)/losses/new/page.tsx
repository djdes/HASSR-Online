import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { LossForm } from "@/components/losses/loss-form";

export default async function NewLossPage() {
  const session = await requireAuth();
  const t = await getTranslations("productionLosses");
  const areas = await db.area.findMany({
    where: { organizationId: getActiveOrgId(session) },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-5">
      <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold">{t("newTitle")}</h1>
      <LossForm areas={areas} />
    </div>
  );
}
