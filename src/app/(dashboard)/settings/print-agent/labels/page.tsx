import Link from "next/link";
import { forbidden } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { PageHeader } from "@/components/ui/page-header";
import { formatDate, isLocale, type Locale } from "@/i18n/locales";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  LABEL_PERIODS,
  LABEL_SOON_MS,
  labelPeriodStart,
  labelStatus,
  parseLabelPeriod,
  readLabelFields,
  type LabelPeriod,
  type LabelStatus,
} from "@/lib/label-prints";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { orgDayStartInstant } from "@/lib/timezone";

export const dynamic = "force-dynamic";

/** Больше за раз не показываем: журнал — для глаз, а не выгрузка. */
const LIMIT = 300;

const DATE: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" };
const DATE_TIME: Intl.DateTimeFormatOptions = { ...DATE, hour: "2-digit", minute: "2-digit" };

const STATUS_TONE: Record<LabelStatus, string> = {
  ok: "bg-[#ecfdf5] text-[#136c3e]",
  soon: "bg-[#fff8eb] text-[#7a4a00]",
  expired: "bg-[#fff4f2] text-[#a13a32]",
  none: "bg-[#f4f4f7] text-[#6f7282]",
};

/**
 * Журнал маркировки (2026-10-31): этикетки, напечатанные в «Сетап
 * помощнике», — что промаркировано, когда изготовлено, до какого времени
 * годно и кто. Телефон присылает их событиями `label_printed`, когда у него
 * есть сеть (`/api/setup-helper/sync`).
 *
 * `?period=today|7d|30d` — по времени печати; `?attention=1` — этикетки, чей
 * срок истёк за период или истекает в ближайшие сутки (когда бы их ни
 * напечатали). Даты — в часовом поясе организации.
 */
export default async function LabelLogPage({
  searchParams,
}: {
  searchParams: Promise<{ [name: string]: string | string[] | undefined }>;
}) {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  const query = await searchParams;
  const period = parseLabelPeriod(query.period);
  const attention = query.attention === "1";

  const [t, rawLocale, organization] = await Promise.all([
    getTranslations("printAgent.labelLog"),
    getLocale(),
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
  ]);
  const locale: Locale = isLocale(rawLocale) ? rawLocale : "ru";
  const timeZone = organization?.timezone || "Europe/Moscow";
  const now = new Date();
  const from = labelPeriodStart(period, orgDayStartInstant(timeZone, now));

  const rows = await db.labelPrint.findMany({
    where: attention
      ? { organizationId, until: { gte: from, lte: new Date(now.getTime() + LABEL_SOON_MS) } }
      : { organizationId, printedAt: { gte: from } },
    orderBy: attention ? { until: "asc" } : { printedAt: "desc" },
    take: LIMIT,
    select: {
      id: true,
      templateTitle: true,
      item: true,
      copies: true,
      startAt: true,
      startLabel: true,
      until: true,
      untilLabel: true,
      dateOnly: true,
      employee: true,
      employeeLabel: true,
      fields: true,
      printedAt: true,
      printerAddress: true,
      device: { select: { name: true } },
    },
  });
  const printers = rows.length
    ? await db.labelPrinter.findMany({
        where: { organizationId, address: { in: [...new Set(rows.map((row) => row.printerAddress))] } },
        select: { address: true, name: true },
      })
    : [];
  const printerName = new Map(printers.map((printer) => [printer.address, printer.name]));

  const when = (date: Date, dateOnly = false) => formatDate(locale, date, timeZone, dateOnly ? DATE : DATE_TIME);
  const href = (next: { period?: LabelPeriod; attention?: boolean }) => {
    const params = new URLSearchParams();
    const nextPeriod = next.period ?? period;
    if (nextPeriod !== "today") params.set("period", nextPeriod);
    if (next.attention ?? attention) params.set("attention", "1");
    const text = params.toString();
    return `/settings/print-agent/labels${text ? `?${text}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />

      <div className="flex flex-wrap items-center gap-2" data-label-log-filters>
        {LABEL_PERIODS.map((item) => (
          <Link
            key={item}
            href={href({ period: item })}
            aria-current={item === period ? "page" : undefined}
            className={`inline-flex h-10 items-center rounded-2xl px-4 text-[13.5px] font-medium transition-colors ${
              item === period
                ? "bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)]"
                : "border border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            }`}
          >
            {t(`periods.${item}`)}
          </Link>
        ))}
        <Link
          href={href({ attention: !attention })}
          role="switch"
          aria-checked={attention}
          className={`inline-flex h-10 items-center rounded-2xl border px-4 text-[13.5px] font-medium transition-colors ${
            attention
              ? "border-[#f5d9a8] bg-[#fff8eb] text-[#7a4a00]"
              : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          }`}
        >
          {t("attention")}
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-[#dcdfed] bg-white px-6 py-10 text-center text-[14px] leading-relaxed text-[#6f7282]">
          {attention ? t("emptyAttention") : t("empty")}
        </p>
      ) : (
        <ul className="space-y-2.5" data-label-log>
          {rows.map((row) => {
            const status = labelStatus(row.until, now);
            const fields = readLabelFields(row.fields);
            const meta = [
              t("printed", { when: when(row.printedAt) }),
              printerName.get(row.printerAddress) ?? row.printerAddress,
              row.device?.name ?? null,
            ].filter(Boolean);
            return (
              <li
                key={row.id}
                className="rounded-2xl border border-[#ececf4] bg-white px-4 py-3.5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:px-5"
                data-label-status={status}
              >
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0">
                    <div className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">
                      {row.templateTitle}
                    </div>
                    <div className="mt-0.5 text-[16px] font-semibold leading-snug text-[#0b1024] [overflow-wrap:anywhere]">
                      {row.item}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium ${STATUS_TONE[status]}`}>
                    {t(`status.${status}`)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-[#3c4053]">
                  {row.startAt ? (
                    <span>{t("start", { label: row.startLabel || t("startDefault"), when: when(row.startAt, row.dateOnly) })}</span>
                  ) : null}
                  {row.until ? (
                    <span className="font-semibold text-[#0b1024]">
                      {t("until", { label: row.untilLabel || t("untilDefault"), when: when(row.until, row.dateOnly) })}
                    </span>
                  ) : null}
                  {row.employee ? (
                    <span>{t("by", { label: row.employeeLabel || t("byDefault"), name: row.employee })}</span>
                  ) : null}
                  <span>{t("copies", { count: row.copies })}</span>
                </div>
                {fields.length > 0 ? (
                  <div className="mt-1 text-[13px] leading-relaxed text-[#6f7282] [overflow-wrap:anywhere]">
                    {fields.map((field) => `${field.label}: ${field.value}`).join(" · ")}
                  </div>
                ) : null}
                <div className="mt-1.5 text-[12.5px] text-[#6f7282]">{meta.join(" · ")}</div>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length >= LIMIT ? <p className="text-[12.5px] text-[#6f7282]">{t("limit", { count: String(LIMIT) })}</p> : null}
      <p className="text-[12.5px] leading-relaxed text-[#6f7282]">{t("note")}</p>
    </div>
  );
}
