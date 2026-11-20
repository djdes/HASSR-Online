"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { exchangeError, exchangeRequest } from "./exchange-api";

const OUTLINE =
  "inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-50";

/**
 * Код мастер-кабинета для другой компании (спека org-exchange-foreign, Р1).
 * Владелец передаёт его тем, кто хочет обмениваться с ним справочниками, —
 * их запрос придёт ему на почту. Кабинета ещё нет — «Получить код» заводит
 * его. Видит только владелец аккаунта: код приходит в состоянии обмена
 * только ему.
 */
export function ExchangeCabinetCode({
  code,
  className,
  onCode,
}: {
  code: string | null;
  className?: string;
  /** Код появился (кабинет создан) — карточка перечитывает состояние. */
  onCode?: () => void;
}) {
  const t = useTranslations("dashboardUi.directoryExchange.foreign.card");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const shown = code ?? fresh;

  async function obtain() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await exchangeRequest("/cabinet", { method: "POST" });
      const cabinet = response.json?.cabinet;
      const raw = cabinet && typeof cabinet === "object" ? (cabinet as { code?: unknown }).code : null;
      const next = typeof raw === "string" ? raw.trim() : "";
      if (!response.ok || !next) {
        toast.error(exchangeError(response.json, t("codeFailed")));
        return;
      }
      setFresh(next);
      onCode?.();
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Буфер обмена недоступен (старый браузер, запрет) — код виден, его можно выделить.
      toast.message(shown);
    }
  }

  return (
    <div className={className} data-testid="exchange-cabinet-code">
      <div className="text-[13px] font-medium text-[#3c4053]">{t("codeTitle")}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {shown ? (
          <>
            <span
              className="inline-flex h-9 items-center rounded-xl border border-[#dcdfed] bg-[#fafbff] px-3 font-mono text-[14px] tracking-[0.04em] text-[#0b1024]"
              data-testid="exchange-cabinet-code-value"
            >
              {shown}
            </span>
            <button type="button" onClick={copy} className={OUTLINE} data-testid="exchange-cabinet-code-copy">
              {copied ? <Check className="size-4 text-[#1c8a4b]" aria-hidden /> : <Copy className="size-4 text-[#5566f6]" aria-hidden />}
              {copied ? t("codeCopied") : t("codeCopy")}
            </button>
          </>
        ) : (
          <button type="button" onClick={obtain} disabled={busy} className={OUTLINE} data-testid="exchange-cabinet-code-get">
            {busy ? (
              <Loader2 className="size-4 animate-spin text-[#5566f6]" aria-hidden />
            ) : (
              <KeyRound className="size-4 text-[#5566f6]" aria-hidden />
            )}
            {t("codeGet")}
          </button>
        )}
      </div>
      <p className="mt-2 max-w-[720px] text-[12.5px] leading-[1.5] text-[#6f7282]">{t("codeHint")}</p>
    </div>
  );
}
