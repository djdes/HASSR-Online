import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Palette } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { POSTER_GROUPS, orderPosters, posterInJournal } from "@/lib/ppk/posters";
import { loadDisinfectantJournalNames } from "@/lib/ppk/poster-data.server";
import { loadPrintBrand } from "@/lib/print-brand.server";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { PosterSheet } from "@/components/production-control/poster-sheet";
import { PostersPicker, type PosterPickerGroup } from "@/components/production-control/posters-picker";

export const dynamic = "force-dynamic";

/**
 * Блок «Плакаты»: 17 плакатов в четырёх группах в одном фирменном стиле
 * (рамка цвета организации, логотип слева, сайт справа). Выбрать галочками и
 * напечатать, либо напечатать все; «Ч/б» — для чёрно-белого принтера.
 */
export default async function PostersPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const organizationId = getActiveOrgId(session);

  const [brand, journalNames, t] = await Promise.all([
    loadPrintBrand(organizationId),
    loadDisinfectantJournalNames(organizationId),
    getTranslations("productionControl.posters"),
  ]);

  const ordered = orderPosters(journalNames);
  const groups: PosterPickerGroup[] = POSTER_GROUPS.map((group) => ({
    key: group.key,
    title: group.title,
    items: ordered
      .filter((poster) => poster.group === group.key)
      .map((poster) => ({
        key: poster.key,
        title: poster.title,
        inJournal: posterInJournal(poster, journalNames),
        preview: <PosterSheet poster={poster} brand={brand} size="preview" />,
      })),
  }));

  return (
    <div className="space-y-5">
      <PpkBlockHeader blockKey="posters" lead={t("lead")} />

      <div className="flex flex-col gap-3 rounded-3xl border border-[#ececf4] bg-[#f5f6ff] p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13.5px] leading-snug text-[#3c4053]">{t("brandingHint")}</p>
        <Link
          href="/settings/organization/branding"
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          <Palette className="size-4" aria-hidden />
          {t("brandingLink")}
        </Link>
      </div>

      <PostersPicker groups={groups} />
    </div>
  );
}
