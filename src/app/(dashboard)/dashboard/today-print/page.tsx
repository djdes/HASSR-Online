import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { customJournalName } from "@/lib/custom-names";
import { db } from "@/lib/db";
import { getOrgCustomNames } from "@/lib/org-custom-names";
import { parsePrintCodes } from "@/lib/today-print";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/**
 * Лист «Что заполнить сегодня» для кухни (08.11.2026): дата, организация,
 * незаполненные журналы с клетками «Готово», «Кто», «Время». Список — с
 * «Сегодня» (параметр `codes`); названия — свои названия организации. На
 * бумаге — только лист: меню и шапка кабинета при печати скрыты.
 */
export default async function TodayPrintPage({ searchParams }: { searchParams: Promise<{ codes?: string | string[] }> }) {
  const session = await requireAuth();
  const organizationId = getActiveOrgId(session);
  const { codes: rawCodes } = await searchParams;
  const codes = parsePrintCodes(rawCodes);
  const t = await getTranslations("dashboardUi.todayPrint");
  const locale = await getLocale();

  const [templates, org, customNames] = await Promise.all([
    codes.length > 0
      ? db.journalTemplate.findMany({ where: { code: { in: codes } }, select: { code: true, name: true } })
      : Promise.resolve([] as Array<{ code: string; name: string }>),
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true, timezone: true } }),
    getOrgCustomNames(organizationId),
  ]);
  const byCode = new Map(templates.map((template) => [template.code, template.name]));
  const rows = codes
    .filter((code) => byCode.has(code))
    .map((code) => ({ code, name: customJournalName(customNames, code) ?? byCode.get(code)! }));
  let date: string;
  try {
    date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", weekday: "long", timeZone: org?.timezone || "Europe/Moscow" }).format(new Date());
  } catch {
    date = new Date().toLocaleDateString(locale);
  }

  return (
    <div className="mx-auto max-w-[760px] space-y-5" data-today-print="">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[#3848c7] hover:underline">
          <ArrowLeft className="size-4" aria-hidden />
          {t("back")}
        </Link>
        <PrintButton label={t("print")} />
      </div>

      <article className="rounded-3xl border border-[#ececf4] bg-white p-6 sm:p-8 print:rounded-none print:border-0 print:p-0">
        <header className="mb-5 border-b border-[#0b1024] pb-3">
          <h1 className="text-[24px] font-semibold text-[#0b1024]">{t("title")}</h1>
          <p className="mt-1 text-[14px] text-[#3c4053]">
            {org?.name ?? ""} · {date}
          </p>
        </header>

        {rows.length === 0 ? (
          <p className="text-[15px] text-[#3c4053]" data-testid="today-print-empty">{t("empty")}</p>
        ) : (
          <table className="w-full border-collapse text-left text-[14px] text-[#0b1024]" data-testid="today-print-table">
            <thead>
              <tr className="border-b border-[#0b1024] text-[12px] uppercase tracking-[0.08em] text-[#3c4053]">
                <th className="w-[56px] py-2 pr-2 font-semibold">{t("done")}</th>
                <th className="py-2 pr-3 font-semibold">{t("journal")}</th>
                <th className="w-[150px] py-2 pr-3 font-semibold">{t("who")}</th>
                <th className="w-[80px] py-2 font-semibold">{t("time")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.code} data-print-journal={row.code} className="border-b border-[#c9ccdb] align-top">
                  <td className="py-3 pr-2">
                    <span aria-hidden className="inline-block size-5 rounded-[4px] border-2 border-[#0b1024]" />
                  </td>
                  <td className="py-3 pr-3 font-medium">
                    {index + 1}. {row.name}
                  </td>
                  <td className="py-3 pr-3" />
                  <td className="py-3" />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </div>
  );
}
