import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { POSTERS, findPoster } from "@/lib/ppk/posters";
import { PrintJournalButton } from "@/components/journals/print-journal-button";
import { loadPpkPrintOrg } from "@/components/production-control/ppk-print-sheet";
import { PosterSheet } from "@/components/production-control/poster-sheet";

export const dynamic = "force-dynamic";

/** Печать плаката: один ключ или `all` — все шесть, каждый на отдельном листе A4. */
export default async function PosterPrintPage({ params }: { params: Promise<{ key: string }> }) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const { key } = await params;

  const poster = key === "all" ? null : findPoster(key);
  if (key !== "all" && !poster) notFound();
  const list = poster ? [poster] : POSTERS;

  const [org, t] = await Promise.all([
    loadPpkPrintOrg(getActiveOrgId(session)),
    getTranslations("productionControl.posters"),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex justify-end print:hidden">
        <PrintJournalButton label={t("print")} />
      </div>
      {list.map((item, index) => (
        <div key={item.key} className={index < list.length - 1 ? "print:break-after-page" : undefined}>
          <PosterSheet poster={item} org={org} />
        </div>
      ))}
    </div>
  );
}
