"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Maximize2, Printer, QrCode, X } from "lucide-react";

const PRIMARY =
  "inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60";
const OUTLINE =
  "inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * Шаг ① «Пришла проверка»: QR проверяющего прямо на экране. Телефон или
 * планшет можно просто развернуть к проверяющему — «На весь экран»
 * убирает всё лишнее. Нет QR — руководство выпускает его одной кнопкой
 * (бессрочный, до отзыва; тот же, что печатается на листе A4).
 */
export function InspectionQr({
  qr,
  organizationName,
  canIssue,
}: {
  qr: { id: string; svg: string } | null;
  organizationName: string;
  canIssue: boolean;
}) {
  const t = useTranslations("inspectionDay");
  const router = useRouter();
  const [fullscreen, setFullscreen] = useState(false);
  const [issuing, setIssuing] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  async function issue() {
    setIssuing(true);
    try {
      const response = await fetch("/api/settings/inspector-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "qr", ttl: "forever" }),
      });
      if (!response.ok) throw new Error(t("issueFailed"));
      toast.success(t("issued"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("issueFailed"));
    } finally {
      setIssuing(false);
    }
  }

  if (!qr) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-5">
        <div className="text-[14px] text-[#6f7282]">{canIssue ? t("noQr") : t("askManager")}</div>
        {canIssue ? (
          <button type="button" onClick={issue} disabled={issuing} className={PRIMARY} data-issue-qr>
            {issuing ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
            {issuing ? t("issuing") : t("issueQr")}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={() => setFullscreen(true)}
        aria-label={t("fullscreen")}
        className="mx-auto w-[220px] shrink-0 rounded-2xl border border-[#dcdfed] bg-white p-3 transition-shadow duration-150 hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 sm:mx-0 [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
        data-inspection-qr
        // SVG строит сервер (qrcode) из нашего же адреса — не пользовательский ввод.
        dangerouslySetInnerHTML={{ __html: qr.svg }}
      />
      <div className="flex flex-wrap gap-2 sm:flex-col sm:items-start">
        <button type="button" onClick={() => setFullscreen(true)} className={PRIMARY}>
          <Maximize2 className="size-4" />
          {t("fullscreen")}
        </button>
        <a href={`/inspector-sheet/${qr.id}`} className={OUTLINE}>
          <Printer className="size-4 text-[#5566f6]" />
          {t("print")}
        </a>
      </div>

      {fullscreen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("qrTitle")}
          className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-6 p-6"
          // Белый всегда, и в тёмной теме: камера проверяющего должна прочитать код.
          style={{ background: "#ffffff" }}
          onClick={() => setFullscreen(false)}
        >
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            aria-label={t("close")}
            className="absolute right-4 top-4 inline-flex size-12 items-center justify-center rounded-full border border-[#ececf4] bg-white text-[#3c4053] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            <X className="size-5" />
          </button>
          <div
            className="w-[min(80vmin,560px)] [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qr.svg }}
          />
          <div className="max-w-[560px] text-center text-[20px] font-semibold tracking-[-0.01em]" style={{ color: "#0b1024" }}>
            {organizationName}
          </div>
        </div>
      ) : null}
    </div>
  );
}
