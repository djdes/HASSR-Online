import type { ReactNode } from "react";
import { Download } from "lucide-react";
import { brandPalette } from "@/lib/document-brand";
import { buildDocumentOrgBlock } from "@/lib/document-org-block";
import { loadDocumentOrgBlock } from "@/lib/document-org-block.server";
import { ppkPrintOrgFromBlock, ppkRequisitesLine, type PpkPrintOrg } from "@/lib/ppk/print-org";
import { PrintJournalButton } from "@/components/journals/print-journal-button";

export type { PpkPrintOrg } from "@/lib/ppk/print-org";

/** Логотип, реквизиты и фирменный цвет организации — данные для `PpkPrintSheet`. */
export async function loadPpkPrintOrg(organizationId: string, buildingId: string | null = null): Promise<PpkPrintOrg> {
  // ППК точки (2026-11-01) — в шапке реквизиты точки (адрес, наименование).
  const block =
    (await loadDocumentOrgBlock(organizationId, { buildingId })) ?? buildDocumentOrgBlock({ org: { name: null } });
  return ppkPrintOrgFromBlock(block);
}

/**
 * Фирменная полоса листа: задан цвет организации — он, иначе лист без
 * полосы. `data-print-keep-bg` — опт-аут из ч/б сброса печати кабинета
 * (`app-theme.css`), `print-color-adjust: exact` — иначе браузер не
 * печатает заливку.
 */
export function PpkBrandBand({ org, className = "" }: { org: PpkPrintOrg; className?: string }) {
  if (!org.block.brand.color) return null;
  return (
    <div
      aria-hidden
      data-print-keep-bg
      className={`h-[3px] rounded-full [print-color-adjust:exact] [-webkit-print-color-adjust:exact] ${className}`}
      style={{ background: brandPalette(org.block.brand.color).ink }}
    />
  );
}

/**
 * Печатный лист A4 блоков ППК: на экране белая карточка, в печати — чистая
 * страница. Над листом (только на экране) — кнопка печати.
 */
export function PpkPrintSheet({
  org,
  title,
  subtitle,
  pdfHref,
  pdfLabel,
  largeLogo = false,
  children,
}: {
  org: PpkPrintOrg;
  title: string;
  subtitle?: string;
  /** Адрес PDF собранного документа: рядом с печатью появляется «Скачать PDF». */
  pdfHref?: string;
  pdfLabel?: string;
  /** Логотип вдвое крупнее (политика ХАССП, 2026-10-27): h-24 вместо h-12. Остальные листы ППК — прежние. */
  largeLogo?: boolean;
  children: ReactNode;
}) {
  const requisites = ppkRequisitesLine(org);
  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2 print:hidden">
        {pdfHref ? (
          <a
            href={pdfHref}
            download
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#3c4053] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            <Download className="size-4" aria-hidden />
            {pdfLabel}
          </a>
        ) : null}
        <PrintJournalButton />
      </div>
      <article className="mx-auto w-full max-w-[794px] rounded-3xl border border-[#ececf4] bg-white p-6 text-[14px] leading-[1.6] text-[#0b1024] shadow-[0_20px_60px_-40px_rgba(11,16,36,0.35)] sm:p-12 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {/* Шапка листа — `div`, не `header`: печать прячет все `header`
            (шапку кабинета), а логотип и реквизиты должны уйти на бумагу. */}
        <div className="mb-6 flex items-center gap-4" data-sheet-org>
          {org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logoUrl} alt="" className={largeLogo ? "h-24 w-auto max-w-[320px] object-contain" : "h-12 w-auto max-w-[160px] object-contain"} />
          ) : null}
          <div className="min-w-0">
            <div className="font-semibold">{org.orgName}</div>
            {requisites ? <div className="text-[12.5px] text-[#6f7282]">{requisites}</div> : null}
          </div>
        </div>
        <PpkBrandBand org={org} className="-mt-3 mb-6" />
        <h1 className="text-center text-[20px] font-semibold">{title}</h1>
        {subtitle ? <p className="mt-1 text-center text-[#6f7282]">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
      </article>
    </div>
  );
}
