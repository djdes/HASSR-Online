import Link from "next/link";
import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { PpkFolder } from "@/components/production-control/ppk-folder";

export const dynamic = "force-dynamic";

/** Блок «procedures»: папка файлов. */
export default async function Page() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const t = await getTranslations("productionControl");
  return (
    <div className="space-y-5">
      <PpkBlockHeader
        blockKey="procedures"
        lead={t("blocks.procedures.lead")}
        actions={
          <Link
            href="/settings/services?order=haccp-package"
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            {t("orderHelp")}
          </Link>
        }
      />
      <PpkFolder folder="procedures" canManage />
    </div>
  );
}
