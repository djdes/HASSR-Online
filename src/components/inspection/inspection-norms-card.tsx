import { getLocale, getTranslations } from "next-intl/server";
import { BookOpenText, Download, FileCheck2, FileText } from "lucide-react";

import type { InspectionNorms } from "@/lib/inspection-norms";

const OUTLINE =
  "inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[13.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

const DOCS = [
  { key: "ppk", label: "ppk", pdf: "/api/production-control/program/pdf", file: "/api/production-control/documents/ppk/file" },
  { key: "haccp-plan", label: "haccpPlan", pdf: "/api/production-control/haccp-plan/pdf", file: "/api/production-control/documents/haccp_plan/file" },
] as const;

/**
 * «Нормативка» внутри раздела (скан 83: «Нормативка из ХАССП — ЭлППК»):
 * ППК и план ХАССП — собранный PDF и подписанный экземпляр, — и перечень
 * нормативных документов. Только чтение, без перехода в меню ППК; открыт
 * и заведующей с «проверкой задач» (те же права, что у документов ППК).
 * `bare` — без своего заголовка: на странице «Нормативка» он уже в шапке.
 */
export async function InspectionNormsCard({ norms, bare = false }: { norms: InspectionNorms; bare?: boolean }) {
  const [t, locale] = await Promise.all([getTranslations("inspectionDay.norms"), getLocale()]);
  const date = (ymd: string) =>
    new Date(`${ymd}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <section
      id="norms"
      className="scroll-mt-24 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
      data-inspection-norms
    >
      {bare ? null : (
        <div className="mb-4 flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <BookOpenText className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("title")}</h2>
            <p className="mt-1 text-[14px] text-[#6f7282]">{t("lead")}</p>
          </div>
        </div>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {DOCS.map((doc) => {
          const approval = norms.approvals[doc.key];
          const uploaded = norms.uploaded[doc.key];
          return (
            <li key={doc.key} className="flex flex-col gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4" data-norm-doc={doc.key}>
              <div>
                <div className="text-[15px] font-semibold text-[#0b1024]">{t(doc.label)}</div>
                <div className="mt-0.5 text-[13px] text-[#6f7282]">
                  {approval ? t("approved", { version: String(approval.version), date: date(approval.approvedAt) }) : t("assembled")}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={doc.pdf} className={OUTLINE} data-norm-pdf>
                  <Download className="size-4 text-[#5566f6]" aria-hidden />
                  {t("openPdf")}
                </a>
                {uploaded ? (
                  <a href={doc.file} target="_blank" rel="noopener" className={`${OUTLINE} max-w-full`} title={uploaded.fileName}>
                    <FileCheck2 className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
                    <span className="truncate">{t("uploaded")}</span>
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <details className="group mt-3 rounded-2xl border border-[#ececf4] open:bg-white" data-norm-list>
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-3 text-[14.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 [&::-webkit-details-marker]:hidden">
          <FileText className="size-4 text-[#5566f6]" aria-hidden />
          <span className="min-w-0 flex-1">{t("listTitle")}</span>
          <span className="rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[12px] tabular-nums text-[#3848c7]">{norms.norms.length}</span>
        </summary>
        <div className="px-4 pb-4">
          <p className="text-[12.5px] text-[#6f7282]">{norms.normsSource === "org" ? t("listOrg") : t("listRecommended")}</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13.5px] leading-[1.55] text-[#3c4053] marker:text-[#9b9fb3]">
            {norms.norms.map((title, index) => (
              <li key={`${index}-${title}`} className="[overflow-wrap:anywhere]">
                {title}
              </li>
            ))}
          </ol>
        </div>
      </details>
    </section>
  );
}
