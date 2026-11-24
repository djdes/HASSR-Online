import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarClock, Download, FileCheck2, QrCode, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { PpkProgressBar } from "@/components/production-control/ppk-progress-bar";

export type ReadinessData = {
  done: number;
  total: number;
  /** Документы пунктов с текстом или сканом: сколько без утверждённой редакции. */
  docs: { pending: number; total: number };
  /** Ознакомление с программой; null — программа не утверждена, лист закрыт. */
  ack: { acknowledged: number; total: number } | null;
  /** Пересмотр программы: дата (дд.мм.гггг) и близость срока; null — версии нет. */
  review: { date: string; state: "ok" | "soon" | "overdue" } | null;
};

/**
 * «Готовность к проверке» (новый вид обзора, 2026-11-24; по образцу FoodReady и
 * Safefood 360): заполненность структуры и три сигнала — редакции документов,
 * ознакомление с программой, пересмотр программы; быстрые действия — печатная
 * программа и «Пришла проверка» (QR для проверяющего).
 */
export async function PpkReadinessPanel({ data }: { data: ReadinessData }) {
  const t = await getTranslations("productionControl.overviewV2");
  const percent = data.total > 0 ? Math.round((data.done / data.total) * 100) : 0;
  const tile = "flex min-w-0 flex-col gap-1 rounded-2xl bg-[var(--app-veil)] px-3.5 py-3";
  return (
    <section className="space-y-3 rounded-3xl bg-white p-4 sm:p-5" data-ppk-readiness>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-[#0b1024]">{t("readinessTitle")}</h2>
          <p className="text-[13px] text-[#6f7282]">{t("readinessFilled", { done: String(data.done), total: String(data.total) })}</p>
        </div>
        <span className="text-[28px] leading-none font-semibold tracking-[-0.02em] tabular-nums text-[#0b1024]" data-ppk-readiness-percent>
          {percent}%
        </span>
      </div>
      <PpkProgressBar done={data.done} total={data.total} label={t("readinessFilled", { done: String(data.done), total: String(data.total) })} />

      <div className="grid gap-2 sm:grid-cols-3">
        <div className={tile} data-ppk-readiness-docs>
          <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#6f7282]">
            <FileCheck2 className="size-3.5" aria-hidden />
            {t("docsTitle")}
          </span>
          <span className={cn("text-[14px] font-medium", data.docs.pending > 0 ? "text-[#b45309]" : "text-[#116b2a]")}>
            {data.docs.total === 0 ? t("docsNone") : data.docs.pending > 0 ? t("docsPending", { count: data.docs.pending }) : t("docsApproved")}
          </span>
          <Link href="/production-control/revisions" className="text-[12.5px] font-medium text-[#3848c7] hover:text-[#5566f6]">
            {t("docsOpen")}
          </Link>
        </div>
        <div className={tile} data-ppk-readiness-ack>
          <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#6f7282]">
            <Users className="size-3.5" aria-hidden />
            {t("ackTitle")}
          </span>
          <span className={cn("text-[14px] font-medium", data.ack && data.ack.acknowledged >= data.ack.total ? "text-[#116b2a]" : "text-[#0b1024]")}>
            {data.ack ? t("ackValue", { done: String(data.ack.acknowledged), total: String(data.ack.total) }) : t("ackClosed")}
          </span>
          <Link href="/production-control/item/3-7" scroll={false} prefetch={false} className="text-[12.5px] font-medium text-[#3848c7] hover:text-[#5566f6]">
            {t("ackOpen")}
          </Link>
        </div>
        <div className={tile} data-ppk-readiness-review>
          <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#6f7282]">
            <CalendarClock className="size-3.5" aria-hidden />
            {t("reviewTitle")}
          </span>
          <span
            className={cn(
              "text-[14px] font-medium",
              data.review?.state === "overdue" ? "text-[#a13a32]" : data.review?.state === "soon" ? "text-[#b45309]" : "text-[#0b1024]",
            )}
          >
            {data.review
              ? data.review.state === "overdue"
                ? t("reviewOverdue", { date: data.review.date })
                : t("reviewDue", { date: data.review.date })
              : t("reviewNone")}
          </span>
          <Link href="/production-control/program" className="text-[12.5px] font-medium text-[#3848c7] hover:text-[#5566f6]">
            {t("reviewOpen")}
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href="/api/production-control/program/pdf"
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--app-veil)] px-3.5 text-[13.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:bg-[var(--app-veil-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          data-ppk-download-pdf
        >
          <Download className="size-4" aria-hidden />
          {t("downloadPdf")}
        </a>
        <Link
          href="/inspection"
          className="inline-flex h-9 items-center gap-2 rounded-xl bg-[var(--app-veil)] px-3.5 text-[13.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:bg-[var(--app-veil-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          data-ppk-inspection-link
        >
          <QrCode className="size-4" aria-hidden />
          {t("inspectionOpen")}
        </Link>
      </div>
    </section>
  );
}
