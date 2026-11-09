import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { BrandLogo } from "@/components/brand/logo";
import { getViewedPointId } from "@/lib/active-building";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { customJournalName } from "@/lib/custom-names";
import { db } from "@/lib/db";
import { getDisabledJournalCodes } from "@/lib/disabled-journals";
import { sortJournalsByName } from "@/lib/journal-sort";
import { MEMO_PRINT, memoDensity } from "@/lib/journals-memo";
import { getOrgCustomNames } from "@/lib/org-custom-names";
import { hasCapability } from "@/lib/permission-presets";
import { PrintButton } from "../today-print/print-button";

export const dynamic = "force-dynamic";

/**
 * Памятка по заполнению журналов (09.11.2026, просьба владельца): один лист
 * А4 — по строке на журнал, слева название, справа — как часто заполнять.
 * Шапка: слева логотип организации, справа — знак WeSetup. В списке —
 * журналы, которые организация ведёт (точка из шапки), по алфавиту, как на
 * «Сегодня». Периодичность — регламент журнала по умолчанию
 * (`journalWidgets.periodicity`, тот же текст, что в шапке документа).
 * На бумаге — только лист; кегль печати зависит от числа строк, чтобы и
 * полный каталог уместился на одной странице (`lib/journals-memo.ts`).
 */
export default async function JournalsMemoPage() {
  const session = await requireAuth();
  if (!hasCapability(session.user, "journals.view")) redirect("/mini/today");
  const organizationId = getActiveOrgId(session);
  const viewedPoint = await getViewedPointId(session);
  const t = await getTranslations("dashboardUi.journalsMemo");
  const tPeriodicity = await getTranslations("journalWidgets.periodicity");

  const [templates, org, customNames, disabledCodes] = await Promise.all([
    db.journalTemplate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { code: true, name: true },
    }),
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true, logoUrl: true } }),
    getOrgCustomNames(organizationId),
    getDisabledJournalCodes(organizationId, viewedPoint),
  ]);

  const rows = sortJournalsByName(
    templates
      .filter((template) => !disabledCodes.has(template.code))
      .map((template) => ({
        code: template.code,
        name: customJournalName(customNames, template.code) ?? template.name,
        // Журнал вне каталога (свой шаблон) — общий текст, а не пустая ячейка.
        howOften: tPeriodicity.has(template.code as never)
          ? tPeriodicity(template.code as never)
          : tPeriodicity("fallback"),
      })),
    (row) => row.name,
  );
  const print = MEMO_PRINT[memoDensity(rows.length)];
  const printVars = {
    "--memo-fs": `${print.fontPt}pt`,
    "--memo-py": `${print.padMm}mm`,
    "--memo-lh": String(print.lineHeight),
  } as React.CSSProperties;

  return (
    <div className="mx-auto max-w-[860px] space-y-5 print:max-w-none print:space-y-0" data-poster-print-root data-journals-memo="">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#3848c7] hover:underline">
          <ArrowLeft className="size-4" aria-hidden />
          {t("back")}
        </Link>
        <PrintButton label={t("print")} />
      </div>

      <article className="rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-8 print:rounded-none print:border-0 print:p-0">
        {/* Не <header>: общие правила печати прячут любой <header> (шапку
            кабинета), и шапка листа пропала бы с бумаги.
            Слева — логотип организации, справа — WeSetup. */}
        <div className="border-b border-[#0b1024] pb-3 print:pb-[1.5mm]" data-memo-head="">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center" data-memo-org="">
              {org?.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={org.logoUrl}
                  alt={org.name}
                  referrerPolicy="no-referrer"
                  className="h-10 w-auto max-w-[200px] object-contain object-left print:h-[10mm]"
                />
              ) : (
                <span className="truncate text-[16px] font-semibold text-[#0b1024] print:text-[12pt]">{org?.name ?? ""}</span>
              )}
            </div>
            {/* На экране знак — маской (сам темнеет и светлеет с темой); маска —
                это фон, а фон на бумагу не печатается, поэтому для печати —
                тёмный файл знака картинкой. */}
            <BrandLogo height={20} className="shrink-0 text-[#0b1024] print:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/wordmark-dark.png" alt="WeSetup" className="hidden h-[5.5mm] w-auto shrink-0 print:block" data-memo-wesetup="" />
          </div>
          <h1 className="mt-4 text-[22px] font-semibold leading-tight text-[#0b1024] print:mt-[2mm] print:text-[14pt]">{t("title")}</h1>
          <p className="mt-1 text-[14px] text-[#3c4053] print:mt-[0.5mm] print:text-[8.5pt]">{t("lead")}</p>
        </div>

        {rows.length === 0 ? (
          <p className="mt-5 text-[15px] text-[#3c4053]" data-testid="journals-memo-empty">{t("empty")}</p>
        ) : (
          <table
            className="w-full border-collapse text-left text-[14px] text-[#0b1024] print:text-[length:var(--memo-fs)] print:leading-[var(--memo-lh)]"
            style={printVars}
            data-testid="journals-memo-table"
          >
            <thead>
              <tr className="border-b border-[#0b1024] text-[12px] uppercase tracking-[0.08em] text-[#3c4053] print:text-[7.5pt]">
                <th className="w-[44%] py-2 pr-4 font-semibold print:py-[1mm]">{t("journal")}</th>
                <th className="py-2 font-semibold print:py-[1mm]">{t("howOften")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.code}
                  data-memo-journal={row.code}
                  className="break-inside-avoid border-b border-[#c9ccdb] align-top max-sm:flex max-sm:flex-col max-sm:py-2.5 print:table-row print:py-0"
                >
                  <td className="py-2.5 pr-4 font-medium max-sm:py-0 max-sm:pr-0 print:py-[var(--memo-py)] print:pr-[4mm]">{row.name}</td>
                  <td className="py-2.5 text-[#3c4053] max-sm:py-0 max-sm:pt-0.5 max-sm:text-[13.5px] print:py-[var(--memo-py)] print:text-[length:inherit] print:text-[#0b1024]">{row.howOften}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </div>
  );
}
