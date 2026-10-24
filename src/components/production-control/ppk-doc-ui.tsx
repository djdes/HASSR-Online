import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import type { PpkPrintOrg } from "@/components/production-control/ppk-print-sheet";

/** Плашка пустого раздела: только на экране, со ссылкой на блок, который его заполнит. */
export type PpkEmptyBanner = { href: string; text: string; linkText: string };

/**
 * Раздел собираемого документа. Пустой — на экране плашка со ссылкой на
 * блок, в печати строка «Не заполнено».
 */
export async function PpkDocSection({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: PpkEmptyBanner | null;
  children?: ReactNode;
}) {
  const t = await getTranslations("productionControlUi");
  return (
    <section className="mt-5 break-inside-avoid-page">
      <h2 className="mb-2 text-[15px] font-semibold">{title}</h2>
      {empty ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#fff7e6] px-4 py-3 text-[14px] text-[#8a5a00] print:hidden">
            <span>{empty.text}</span>
            <Link
              href={empty.href}
              className="font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6]"
            >
              {empty.linkText}
            </Link>
          </div>
          <p className="hidden text-[#6f7282] print:block">{t("ppkDocUi.notFilled")}</p>
        </>
      ) : (
        children
      )}
    </section>
  );
}

/** Таблица документа: рамки по краю, шапка полужирным, строки не рвутся между листами. */
export function PpkDocTable({
  heads,
  rows,
  small = false,
}: {
  heads: string[];
  rows: ReactNode[][];
  small?: boolean;
}) {
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className={`w-full border-collapse ${small ? "text-[11.5px]" : "text-[13px]"}`}>
        <thead>
          <tr>
            {heads.map((head) => (
              <th key={head} className="border border-[#0b1024] px-2 py-1.5 text-left font-semibold">
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, index) => (
            <tr key={index} className="break-inside-avoid align-top">
              {cells.map((cell, cellIndex) => (
                <td key={cellIndex} className="whitespace-pre-line border border-[#0b1024] px-2 py-1.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Строка «УТВЕРЖДАЮ»: должность и ФИО руководителя из реквизитов, подпись и дата.
 * Если у документа есть утверждённая версия с утвердившим — вместо руководителя он, с датой версии.
 */
export async function PpkApproveBlock({
  org,
  approval,
}: {
  org: PpkPrintOrg;
  approval?: { approvedAt: string; approver: { name: string; title: string } | null } | null;
}) {
  const t = await getTranslations("productionControlUi");
  const director = org.snapshot;
  const approver = approval?.approver ?? null;
  return (
    <div className="mb-6 ml-auto w-[260px] text-[13.5px]">
      <div className="font-semibold">{t("ppkDocUi.approve")}</div>
      <div>{approver ? approver.title || t("ppkDocUi.leader") : director?.directorPost || t("ppkDocUi.leader")}</div>
      <div>{approver ? approver.name : director?.directorName || "—"}</div>
      <div className="mt-4 flex items-end gap-2">
        <span className="w-[110px] border-b border-[#0b1024]" />
        <span>/</span>
        <span className="w-[80px] border-b border-[#0b1024]" />
      </div>
      <div className="mt-3">{approver && approval ? t("ppkDocUi.dateYear", { date: ruDate(approval.approvedAt) }) : t("ppkDocUi.datePlaceholder")}</div>
    </div>
  );
}

/** Формат даты YYYY-MM-DD → ДД.ММ.ГГГГ; пусто — «—». */
export function ruDate(value: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}
