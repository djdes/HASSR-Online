import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { PpkFolder } from "@/components/production-control/ppk-folder";

export const dynamic = "force-dynamic";

/** Вкладка «Методические рекомендации» блока «Нормативные документы»: папка файлов. */
export default async function Page() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const t = await getTranslations("productionControl");
  return (
    <div className="space-y-5">
      <PpkBlockHeader
        blockKey="norm-documents"
        lead={t("blocks.guidelines.lead")}
      />
      <PpkFolder folder="guidelines" canManage />
    </div>
  );
}
