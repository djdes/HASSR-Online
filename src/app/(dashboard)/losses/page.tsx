import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { FORMAT_LOCALES, formatNumber } from "@/i18n/locales";
import { isLossCategory, lossUnitCode } from "@/components/losses/loss-presentation";
import { Plus, TrendingDown } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { getViewedPointId } from "@/lib/active-building";
import { db } from "@/lib/db";
import { areaPointWhere, lossPointWhere } from "@/lib/point-filters";

export default async function LossesPage() {
  const session = await requireAuth();
  const locale = await getSiteLocale();
  const t = await getTranslations({ locale, namespace: "productionLosses" });
  // Formatting changes language only; retain the server timezone and RUB.
  const dateFormat = new Intl.DateTimeFormat(FORMAT_LOCALES[locale]);
  const rubles = (amount: number) => t("rubles", { amount: formatNumber(locale, amount, { maximumFractionDigits: 20 }) });
  const displayCategory = (category: string) => isLossCategory(category) ? t(`categories.${category}`) : category;
  const displayUnit = (unit: string) => {
    const key = lossUnitCode(unit);
    return key ? t(`units.${key}`) : unit.trim();
  };
  const orgId = getActiveOrgId(session);

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  // Точка из шапки (2026-10-31): потери точки (2026-11-01: и по `buildingId`
  // — акты списания iiko), её цехов, общих цехов и без места.
  const pointId = await getViewedPointId(session);
  const pointAreas = pointId
    ? await db.area.findMany({ where: { organizationId: orgId, ...areaPointWhere(pointId) }, select: { id: true } })
    : [];
  const atPoint = lossPointWhere(pointId, pointAreas.map((area) => area.id));
  const [records, weekRecords, monthRecords] = await Promise.all([
    db.lossRecord.findMany({
      where: { organizationId: orgId, ...atPoint },
      orderBy: { date: "desc" },
      take: 100,
    }),
    db.lossRecord.findMany({
      where: { organizationId: orgId, date: { gte: weekAgo }, ...atPoint },
    }),
    db.lossRecord.findMany({
      where: { organizationId: orgId, date: { gte: monthAgo }, ...atPoint },
      select: { productName: true, cause: true, costRub: true, quantity: true },
    }),
  ]);

  // Топ-5 продуктов и причин за 30 дней.
  const productRollup = new Map<string, { count: number; cost: number }>();
  const causeRollup = new Map<string, { count: number; cost: number }>();
  for (const r of monthRecords) {
    const cost = r.costRub ?? 0;
    if (r.productName) {
      const v = productRollup.get(r.productName) ?? { count: 0, cost: 0 };
      v.count += 1;
      v.cost += cost;
      productRollup.set(r.productName, v);
    }
    if (r.cause && r.cause.trim()) {
      const k = r.cause.trim();
      const v = causeRollup.get(k) ?? { count: 0, cost: 0 };
      v.count += 1;
      v.cost += cost;
      causeRollup.set(k, v);
    }
  }
  // Откуда запись: `sourceEntryId` указывает на акт списания, из строки
  // которого она заведена. Один запрос на всю страницу.
  const sourceIds = [
    ...new Set(records.map((r) => r.sourceEntryId).filter((id): id is string => !!id)),
  ];
  const sourceDocuments = sourceIds.length
    ? await db.journalDocument.findMany({
        where: { id: { in: sourceIds }, organizationId: orgId },
        select: {
          id: true,
          dateFrom: true,
          template: { select: { code: true } },
        },
      })
    : [];
  const sourceById = new Map(sourceDocuments.map((doc) => [doc.id, doc]));

  const topProducts = [...productRollup.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.cost - a.cost || b.count - a.count)
    .slice(0, 5);
  const topCauses = [...causeRollup.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.cost - a.cost || b.count - a.count)
    .slice(0, 5);

  const weekByCategory: Record<
    string,
    { count: number; totalQty: number; totalCost: number }
  > = {};
  for (const r of weekRecords) {
    if (!weekByCategory[r.category])
      weekByCategory[r.category] = { count: 0, totalQty: 0, totalCost: 0 };
    weekByCategory[r.category].count += 1;
    weekByCategory[r.category].totalQty += r.quantity;
    weekByCategory[r.category].totalCost += r.costRub || 0;
  }
  const totalWeekCost = weekRecords.reduce(
    (sum, r) => sum + (r.costRub || 0),
    0
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
            {t("title")}
          </h1>
          <p className="mt-1.5 text-[14px] text-[#6f7282]">
            {t("description")}
          </p>
        </div>
        <Link
          href="/losses/new"
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] sm:w-auto sm:justify-start sm:self-start"
        >
          <Plus className="size-4" />
          {t("newTitle")}
        </Link>
      </div>

      {/* Weekly summary card */}
      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-[#fff4f2] text-[#a13a32]">
              <TrendingDown className="size-4" />
            </span>
            <div>
              <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-[#6f7282]">
                {t("weekly")}
              </div>
              <div className="text-[15px] font-semibold text-[#0b1024]">
                {t("lossesAndWriteoffs")}
              </div>
            </div>
          </div>
          {totalWeekCost > 0 && (
            <div className="text-[20px] font-semibold tabular-nums text-[#a13a32]">
              {rubles(totalWeekCost)}
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(weekByCategory)
            .sort(([, a], [, b]) => b.totalCost - a.totalCost)
            .map(([cat, data]) => (
              <div
                key={cat}
                className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3"
              >
                <p className="text-[12px] text-[#6f7282]">
                  {displayCategory(cat)}
                </p>
                <p className="mt-0.5 text-[20px] font-semibold tabular-nums text-[#0b1024]">
                  {formatNumber(locale, data.count)}
                </p>
                <p className="mt-0.5 text-[11px] text-[#9b9fb3]">
                  {data.totalCost > 0
                    ? t("quantityCostSummary", { quantity: formatNumber(locale, data.totalQty, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), cost: rubles(data.totalCost) })
                    : t("quantitySummary", { quantity: formatNumber(locale, data.totalQty, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
                </p>
              </div>
            ))}
          {Object.keys(weekByCategory).length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-5 text-center text-[13px] text-[#9b9fb3]">
              {t("noWeekly")}
            </div>
          )}
        </div>
      </div>

      {/* Топ-5 продуктов и причин за 30 дней — для быстрого «что чаще
          списываем» / «по какой причине теряем больше всего денег». */}
      {(topProducts.length > 0 || topCauses.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {topProducts.length > 0 && (
            <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
              <h2 className="text-[15px] font-semibold text-[#0b1024]">
                {t("topProducts")}
              </h2>
              <ol className="mt-4 space-y-2">
                {topProducts.map((p, i) => (
                  <li
                    key={p.name}
                    className="flex items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3 py-2"
                  >
                    <span className="size-7 shrink-0 rounded-full bg-[#fff4f2] text-center text-[13px] font-semibold leading-7 text-[#a13a32]">
                      {formatNumber(locale, i + 1)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] text-[#0b1024]">
                      {p.name}
                    </span>
                    <span className="text-right text-[13px] tabular-nums">
                      <span className="font-semibold text-[#0b1024]">
                        {p.cost > 0
                          ? rubles(p.cost)
                          : "—"}
                      </span>
                      <span className="ml-2 text-[12px] text-[#6f7282]">
                        ×{formatNumber(locale, p.count)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {topCauses.length > 0 && (
            <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
              <h2 className="text-[15px] font-semibold text-[#0b1024]">
                {t("topCauses")}
              </h2>
              <ol className="mt-4 space-y-2">
                {topCauses.map((p, i) => (
                  <li
                    key={p.name}
                    className="flex items-center gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3 py-2"
                  >
                    <span className="size-7 shrink-0 rounded-full bg-[#fff8eb] text-center text-[13px] font-semibold leading-7 text-[#b25f00]">
                      {formatNumber(locale, i + 1)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] text-[#0b1024]">
                      {p.name}
                    </span>
                    <span className="text-right text-[13px] tabular-nums">
                      <span className="font-semibold text-[#0b1024]">
                        {p.cost > 0
                          ? rubles(p.cost)
                          : "—"}
                      </span>
                      <span className="ml-2 text-[12px] text-[#6f7282]">
                        ×{formatNumber(locale, p.count)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}

      {/* Records table */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 md:overflow-visible">
        <div className="min-w-[880px] overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-[#ececf4] bg-[#fafbff] text-left text-[12px] uppercase tracking-wider text-[#6f7282]">
                <th className="px-5 py-3 font-medium">{t("date")}</th>
                <th className="px-5 py-3 font-medium">{t("category")}</th>
                <th className="px-5 py-3 font-medium">{t("product")}</th>
                <th className="px-5 py-3 font-medium">{t("quantity")}</th>
                <th className="px-5 py-3 font-medium">{t("cost")}</th>
                <th className="px-5 py-3 font-medium">{t("cause")}</th>
                <th className="px-5 py-3 font-medium">{t("source")}</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const source = r.sourceEntryId ? sourceById.get(r.sourceEntryId) : undefined;
                return (
                <tr
                  key={r.id}
                  className="border-b border-[#ececf4] last:border-b-0 hover:bg-[#fafbff]"
                >
                  <td className="px-5 py-3 text-[13px] text-[#6f7282]">
                    {dateFormat.format(r.date)}
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center rounded-full border border-[#ececf4] bg-white px-2.5 py-0.5 text-[12px] text-[#3c4053]">
                      {displayCategory(r.category)}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-medium text-[#0b1024]">
                    {r.productName}
                  </td>
                  <td className="px-5 py-3 tabular-nums text-[#0b1024]">
                    {formatNumber(locale, r.quantity, { maximumFractionDigits: 20 })} {displayUnit(r.unit)}
                  </td>
                  <td className="px-5 py-3 tabular-nums text-[#0b1024]">
                    {r.costRub
                      ? rubles(r.costRub)
                      : "—"}
                  </td>
                  <td className="px-5 py-3 text-[13px] text-[#6f7282]">
                    {r.cause || "—"}
                  </td>
                  {/* Откуда запись: из акта списания или заведена руками. */}
                  <td className="px-5 py-3 text-[13px]">
                    {source ? (
                      <Link
                        href={`/journals/${source.template.code}/documents/${source.id}`}
                        className="text-[#3848c7] hover:underline"
                      >
                        {t("fromWriteoff", { date: dateFormat.format(source.dateFrom) })}
                      </Link>
                    ) : r.sourceEntryId?.startsWith("iiko:") ? (
                      // Акт списания из iiko (`/settings/integrations/iiko`).
                      <span className="text-[#3c4053]">{t("fromIiko")}</span>
                    ) : (
                      <span className="text-[#9b9fb3]">{t("manual")}</span>
                    )}
                  </td>
                </tr>
                );
              })}
              {records.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-10 text-center text-[14px] text-[#9b9fb3]"
                  >
                    {t("empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
