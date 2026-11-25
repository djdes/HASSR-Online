"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * «Забрать промокод»: копирует код в буфер и показывает его. Буфер
 * недоступен (старый браузер, http) — код всё равно виден на кнопке,
 * его можно переписать.
 */
export function PromoCodeCopy({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Код и так показан на кнопке — его можно ввести вручную.
    }
    setCopied(true);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      className="inline-flex h-14 items-center justify-center gap-2.5 rounded-2xl border border-[#a3f7d7]/40 bg-[#a3f7d7]/10 px-6 text-[16px] font-bold text-[#a3f7d7] transition-colors duration-200 hover:bg-[#a3f7d7]/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a3f7d7]/40"
    >
      {copied ? (
        <>
          <Check className="size-5" aria-hidden="true" />
          <span>
            Скопирован: <span className="font-mono tracking-[0.1em] text-white">{code}</span>
          </span>
        </>
      ) : (
        <>
          <Copy className="size-5" aria-hidden="true" />
          Забрать промокод {label}
        </>
      )}
    </button>
  );
}
