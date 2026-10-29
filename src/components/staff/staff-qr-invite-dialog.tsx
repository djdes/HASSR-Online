"use client";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useSubmitLock } from "@/lib/use-submit-lock";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Copy, Loader2, Printer, RefreshCcw, X } from "lucide-react";
import { toast } from "sonner";
import { getNativeBridge, PRINT_WINDOW_PAGE_CSS, printHtml } from "@/lib/native-bridge";
import type { StaffPosition } from "@/components/staff/staff-types";

type Props = {
  open: boolean;
  onClose: () => void;
  positions: StaffPosition[];
};

type GeneratedToken = {
  joinUrl: string;
  qrPngDataUrl: string;
  expiresAt: string;
};

/**
 * Диалог «Пригласить по QR» — админ выбирает должность (опционально),
 * жмёт «Сгенерировать» → получает QR-код + ссылку на /join/<token>.
 * Ссылка живёт 7 дней, одноразовая. Распечатать (через window.print)
 * или скопировать.
 */
export function StaffQrInviteDialog({ open, onClose, positions }: Props) {
  const t = useTranslations("staffManagement.qrInvite");
  const locale = useLocale();
  // Двойной тап выпускал две одноразовые ссылки подряд — вторая тут же
  // затирала первую на экране, а первая оставалась висеть в базе.
  const { busy, acquire, release } = useSubmitLock();
  const [posId, setPosId] = useState<string>("");
  const [label, setLabel] = useState("");
  const [token, setToken] = useState<GeneratedToken | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function generate() {
    if (!acquire()) return;
    setError(null);
    try {
      const res = await fetch("/api/staff/join-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suggestedJobPositionId: posId || null,
          label: label.trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        joinUrl?: string;
        qrPngDataUrl?: string;
        expiresAt?: string;
        error?: string;
      };
      if (!res.ok || !data.joinUrl || !data.qrPngDataUrl) {
        throw new Error(t("generateFailed"));
      }
      setToken({
        joinUrl: data.joinUrl,
        qrPngDataUrl: data.qrPngDataUrl,
        expiresAt: data.expiresAt ?? "",
      });
    } catch {
      setError(t("generateFailed"));
    } finally {
      release();
    }
  }

  function copyLink() {
    if (!token) return;
    navigator.clipboard
      .writeText(token.joinUrl)
      .then(() => toast.success(t("linkCopied")))
      .catch(() => toast.error(t("copyFailed")));
  }

  function printQr() {
    if (!token) return;
    const html = `
      <!doctype html>
      <html lang="${locale}"><head><title>${t("print.title")}</title>
      <style>
        ${PRINT_WINDOW_PAGE_CSS}
        body { font-family: -apple-system, system-ui, sans-serif; padding: 40px; text-align: center; color: #0b1024; }
        img { width: 320px; height: auto; margin: 24px auto; display: block; }
        h1 { font-size: 22px; margin-bottom: 4px; }
        p { color: #6f7282; margin: 4px 0; font-size: 14px; }
        .url { font-family: monospace; font-size: 12px; word-break: break-all; margin-top: 16px; color: #3848c7; }
      </style>
      </head><body>
        <h1>${t("print.heading")}</h1>
        <p>${t("print.scan")}</p>
        <img src="${token.qrPngDataUrl}" alt="QR" />
        <p>${t("print.orOpen")}</p>
        <div class="url">${token.joinUrl}</div>
        <p style="margin-top:24px;font-size:12px">${t("print.expiry")}</p>
      </body></html>
    `;
    // В приложении WeSetup новых окон нет — печатаем листок системной печатью.
    if (getNativeBridge()) {
      void printHtml(html);
      return;
    }
    const w = window.open("", "_blank", "width=600,height=800");
    if (!w) {
      toast.error(t("allowPopups"));
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
    >
      <BodyScrollLock />
      {/* max-h + прокрутка: с готовым QR карточка выше, чем 360×640, и
          без этого нижние кнопки «Распечатать» / «Ещё один» уезжали за
          экран, а страница под модалкой не скроллится. */}
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_30px_80px_-20px_rgba(11,16,36,0.55)]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#3848c7]">
              {t("eyebrow")}
            </div>
            <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[#0b1024]">
              {t("title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-[#9b9fb3] hover:bg-[#fafbff] hover:text-[#0b1024]"
            aria-label={t("close")}
          >
            <X className="size-4" />
          </button>
        </div>

        {!token ? (
          <>
            <p className="mb-4 text-[13px] leading-[1.55] text-[#6f7282]">
              {t("description")}
            </p>

            <Field label={t("positionHintLabel")}>
              <select
                value={posId}
                onChange={(e) => setPosId(e.target.value)}
                className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              >
                <option value="">{t("anyPosition")}</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t("labelField")}>
              <input
                type="text"
                placeholder={t("labelPlaceholder")}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </Field>

            {error ? (
              <div className="mt-3 rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] px-3 py-2 text-[13px] text-[#a13a32]">
                {error}
              </div>
            ) : null}

            <button
              type="button"
              onClick={generate}
              disabled={busy}
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:bg-[#c8cbe0]"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy ? t("generating") : t("generate")}
            </button>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-center rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
              <img
                src={token.qrPngDataUrl}
                alt={t("qrAlt")}
                className="h-auto w-[260px] rounded-md bg-white"
              />
            </div>

            <Field label={t("linkLabel")}>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={token.joinUrl}
                  className="h-11 flex-1 rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-3 font-mono text-[12px] text-[#3c4053]"
                />
                <button
                  type="button"
                  onClick={copyLink}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border border-[#dcdfed] text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#5566f6]"
                  title={t("copy")}
                >
                  <Copy className="size-4" />
                </button>
              </div>
            </Field>

            <p className="mt-2 text-[12px] text-[#6f7282]">
              {t("linkExpiry", {
                expiration: token.expiresAt
                  ? new Date(token.expiresAt).toLocaleDateString(locale, { day: "numeric", month: "long" })
                  : t("sevenDays"),
              })}
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={printQr}
                className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#3c4053] transition-colors hover:border-[#5566f6]/50 hover:bg-[#f5f6ff] hover:text-[#5566f6]"
              >
                <Printer className="size-4" />
                {t("printAction")}
              </button>
              <button
                type="button"
                onClick={() => setToken(null)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#6f7282] transition-colors hover:border-[#5566f6]/50 hover:bg-[#f5f6ff]"
              >
                <RefreshCcw className="size-4" />
                {t("another")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
        {label}
      </span>
      {children}
    </label>
  );
}
