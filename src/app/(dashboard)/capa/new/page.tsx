import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { CapaForm } from "@/components/capa/capa-form";

export default async function NewCapaPage() {
  const session = await requireAuth();
  const t = await getTranslations("capaManagement");

  const users = await db.user.findMany({
    where: { organizationId: getActiveOrgId(session), isActive: true },
    select: { id: true, name: true },
  });

  return (
    <div className="space-y-5">
      <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold">
        {t("newTitle")}
      </h1>
      <p className="text-[14px] text-[#6f7282]">
        {t("newDescription")}
      </p>
      <CapaForm users={users} />
    </div>
  );
}
