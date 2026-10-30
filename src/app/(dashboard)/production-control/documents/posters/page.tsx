import Link from "next/link";
import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MapPin, Palette, Plus, Store } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { POSTER_GROUPS, orderPosters, posterInJournal } from "@/lib/ppk/posters";
import { posterPointLine, posterPointParam, resolvePosterPoint, type PosterPointSource } from "@/lib/ppk/poster-point";
import { loadDisinfectantJournalNames, loadPosterPoints } from "@/lib/ppk/poster-data.server";
import { loadPrintBrand } from "@/lib/print-brand.server";
import { PpkBlockHeader } from "@/components/production-control/ppk-block-header";
import { PosterSheet } from "@/components/production-control/poster-sheet";
import { PostersPicker, type PosterPickerGroup } from "@/components/production-control/posters-picker";

export const dynamic = "force-dynamic";

const BASE = "/production-control/documents/posters";

const PILL =
  "inline-flex min-h-10 max-w-full items-center gap-2 rounded-2xl border px-3.5 py-2 text-left text-[13.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * Блок «Плакаты»: 17 плакатов в четырёх группах в одном фирменном стиле
 * (рамка цвета организации, логотип слева, сайт справа). Выбрать галочками и
 * напечатать, либо напечатать все; «Ч/б» — для чёрно-белого принтера.
 *
 * Сверху — торговая точка, для которой печатаем (скан 97): её название стоит
 * на каждом листе, QR «Ежедневного осмотра» ведёт в её журнал. Выбор — в
 * адресе (`?point=`), мини-листы и ссылки печати берут его оттуда.
 */
export default async function PostersPage({
  searchParams,
}: {
  searchParams: Promise<{ [name: string]: string | string[] | undefined }>;
}) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  const query = await searchParams;

  const [brand, journalNames, { points, headerPointId }, t] = await Promise.all([
    loadPrintBrand(organizationId),
    loadDisinfectantJournalNames(organizationId),
    loadPosterPoints(session),
    getTranslations("productionControl.posters"),
  ]);
  const point = resolvePosterPoint(points, posterPointParam(query.point), headerPointId);
  const pointLine = posterPointLine(point);

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
        preview: <PosterSheet poster={poster} brand={brand} size="preview" point={pointLine} />,
      })),
  }));

  const pillTitle = (item: PosterPointSource) => item.name.trim() || item.address?.trim() || t("pointUntitled");
  const pillHint = (item: PosterPointSource) => {
    const line = posterPointLine(item);
    return line ? [line.title, line.detail].filter(Boolean).join(" · ") : undefined;
  };

  return (
    <div className="space-y-5">
      <PpkBlockHeader blockKey="posters" lead={t("lead")} />

      {points.length === 0 ? (
        <div
          className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-8 text-center"
          data-poster-points-empty
        >
          <Store className="mx-auto mb-2 size-6 text-[#9b9fb3]" aria-hidden />
          <div className="text-[15px] font-medium text-[#0b1024]">{t("pointsEmptyTitle")}</div>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] leading-[1.5] text-[#6f7282]">{t("pointsEmptyBody")}</p>
          <Link
            href="/settings/buildings"
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            <Plus className="size-4 text-[#5566f6]" aria-hidden />
            {t("pointsAdd")}
          </Link>
        </div>
      ) : (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-4 sm:p-5" data-poster-point-picker>
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
              <MapPin className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold leading-snug text-[#0b1024]">
                {points.length > 1 ? t("pointTitle") : t("pointSingle")}
              </h2>
              <p className="mt-0.5 text-[13px] leading-snug text-[#6f7282]">{t("pointHint")}</p>
            </div>
          </div>
          <div role="group" aria-label={t("pointTitle")} className="mt-3 flex flex-wrap gap-2">
            {points.map((item) => {
              const active = item.id === point?.id;
              const content = (
                <>
                  <Store className={`size-4 shrink-0 ${active ? "text-[#5566f6]" : "text-[#9b9fb3]"}`} aria-hidden />
                  <span className="min-w-0 truncate">{pillTitle(item)}</span>
                </>
              );
              const look = active
                ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]"
                : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]";
              return points.length > 1 ? (
                <Link
                  key={item.id}
                  href={`${BASE}?point=${encodeURIComponent(item.id)}`}
                  replace
                  scroll={false}
                  aria-current={active ? "true" : undefined}
                  title={pillHint(item)}
                  data-poster-point-option={item.id}
                  className={`${PILL} ${look}`}
                >
                  {content}
                </Link>
              ) : (
                <span key={item.id} title={pillHint(item)} data-poster-point-option={item.id} className={`${PILL} ${look}`}>
                  {content}
                </span>
              );
            })}
          </div>
        </section>
      )}

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

      <PostersPicker groups={groups} pointId={point && points.length > 1 ? point.id : null} />
    </div>
  );
}
