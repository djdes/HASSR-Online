"use client";

import { useState } from "react";
import { FileCheck2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { LegalConsentCheckbox } from "@/components/legal/legal-consent-checkbox";

/**
 * «Мы обновили условия» — один раз у руководителя после новой редакции
 * документов (2026-09-22). Закрыть без согласия нельзя: работа в кабинете
 * продолжается по новой оферте, согласие фиксируется в истории.
 */
export function LegalUpdateModal() {
  const [open, setOpen] = useState(true);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function accept() {
    if (!consent) return;
    setBusy(true);
    try {
      const res = await fetch("/api/legal/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Не удалось сохранить");
      setOpen(false);
      toast.success("Спасибо! Условия приняты");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#0b1024]/45 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-update-title"
        className="flex max-h-[90vh] w-full max-w-[480px] flex-col overflow-hidden rounded-t-3xl bg-white shadow-[0_30px_80px_-30px_rgba(11,16,36,0.55)] sm:rounded-3xl"
        data-testid="legal-update-modal"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-[#ececf4] px-6 py-5">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <FileCheck2 className="size-5" />
          </span>
          <h2 id="legal-update-title" className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            Мы обновили условия
          </h2>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5 text-[14px] leading-[1.6] text-[#3c4053]">
          <p>С 30 сентября 2026 года действует новая редакция оферты. Что изменилось:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>баланс можно пополнять деньгами: внесённое зачисляется баллами (1 ₽ = 1 балл) и идёт на оплату подписки;</li>
            <li>чек и закрывающий документ (УПД) выдаются сразу после каждой оплаты, в том числе пополнения;</li>
            <li>неиспользованный остаток баланса не возвращается, кроме случаев, прямо предусмотренных законом (п. 6.9 оферты).</li>
          </ul>
          <p className="text-[13px] text-[#6f7282]">Ваши данные и уже оплаченные периоды не меняются.</p>
          <LegalConsentCheckbox checked={consent} onChange={setConsent} />
        </div>
        <div className="shrink-0 border-t border-[#ececf4] px-6 py-4">
          <button
            type="button"
            disabled={!consent || busy}
            onClick={() => void accept()}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="legal-update-accept"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Принять и продолжить
          </button>
        </div>
      </div>
    </div>
  );
}
