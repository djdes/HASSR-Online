import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { POSTERS } from "@/lib/ppk/posters";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { loadPpkPrintOrg } from "@/components/production-control/ppk-print-sheet";
import { PosterSheet } from "@/components/production-control/poster-sheet";

export const dynamic = "force-dynamic";

/** Блок «Плакаты»: мини-листы с логотипом организации; открыть или распечатать каждый, либо все сразу. */
export default async function PostersPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);

  const [org, t] = await Promise.all([
    loadPpkPrintOrg(organizationId),
    getTranslations("productionControl.posters"),
  ]);

  return (
    <div className="space-y-5">
      <PpkBlockHeader
        blockKey="posters"
        lead={t("lead")}
        actions={
          <Link
            href="/production-control/documents/posters/all"
            className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            {t("printAll")}
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {POSTERS.map((poster) => (
          <Link
            key={poster.key}
            href={`/production-control/documents/posters/${poster.key}`}
            className="group flex flex-col rounded-3xl border border-[#ececf4] bg-white p-3 transition-colors duration-150 hover:border-[#5566f6]/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            <div className="aspect-[1/1.414] overflow-hidden rounded-2xl border border-[#ececf4]">
              <PosterSheet poster={poster} org={org} size="preview" />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 px-1">
              <span className="text-[14.5px] font-medium text-[#0b1024]">{poster.title}</span>
              <span className="shrink-0 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 group-hover:text-[#5566f6]">
                {t("open")}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
