"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, Download, FileText, Loader2 } from "lucide-react";

import { PAYMENT_GOALS } from "@/lib/payment-goals";
import { ymGoal } from "@/lib/signup-source";
import { cn } from "@/lib/utils";

/**
 * «Платите от организации? Счёт по ИНН — без регистрации» (2026-11-01).
 * Только для гостя: вошедший выставляет счёт на свою организацию в
 * «Настройки → Тариф». Почта — общая с формой оплаты картой. Ссылка
 * `/order…#invoice` (письмо о брошенном заказе) открывает панель сразу.
 */

type Done = { orderId: number; amountRub: number; dueAt: string | null; buyerName: string; pdfUrl: string };

const INPUT =
  "mt-1.5 h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

function rub(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
}

export function GuestInvoicePanel({
  email,
  onEmailChange,
  plan,
  promoCode,
  expectedGrossRub,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  plan: { tier: string; cycle: string; points: number } | null;
  promoCode: string | null;
  expectedGrossRub: number;
}) {
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [inn, setInn] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [found, setFound] = useState<string | null>(null);
  const [needName, setNeedName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    try {
      if (window.location.hash === "#invoice") setOpen(true);
    } catch {
      /* без window — панель закрыта */
    }
  }, []);

  async function lookup(value: string) {
    const digits = value.replace(/\D/g, "");
    setFound(null);
    if (digits.length !== 10 && digits.length !== 12) return;
    try {
      const response = await fetch(`/api/public/inn-lookup?inn=${digits}`);
      const data = (await response.json().catch(() => null)) as { ok?: boolean; shortName?: string; name?: string } | null;
      if (response.ok && data?.ok) {
        setFound(data.shortName || data.name || null);
        setNeedName(false);
      } else {
        setNeedName(true);
      }
    } catch {
      setNeedName(true);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !plan) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/payments/invoice/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inn,
          email,
          companyName: companyName || undefined,
          plan: plan.tier,
          cycle: plan.cycle,
          points: plan.points,
          promoCode: promoCode ?? undefined,
          expectedGrossRub,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<Done> & { error?: string; code?: string };
      if (!response.ok) {
        if (data.code === "name-required") setNeedName(true);
        setError(data.error ?? "Не удалось выставить счёт. Попробуйте ещё раз или позвоните нам");
        return;
      }
      ymGoal(PAYMENT_GOALS.invoice, { plan: `${plan.tier}_${plan.cycle}` });
      setDone(data as Done);
    } catch {
      setError("Сеть недоступна. Попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="invoice" className="mt-6 scroll-mt-24 rounded-2xl border border-[#ececf4] bg-[#fafbff]" data-guest-invoice>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${ids}-body`}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
      >
        <FileText className="size-5 shrink-0 text-[#5566f6]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-[#0b1024]">Платите от организации?</span>
          <span className="block text-[13px] text-[#6f7282]">Выставим счёт по ИНН без регистрации — PDF сразу на почту</span>
        </span>
        <ChevronDown className={cn("size-5 shrink-0 text-[#9b9fb3] transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open ? (
        <div id={`${ids}-body`} className="border-t border-[#ececf4] px-5 pb-5 pt-4">
          {done ? (
            <div data-guest-invoice-done>
              <div className="flex items-center gap-2 text-[15px] font-semibold text-[#136b2a]">
                <CheckCircle2 className="size-5" aria-hidden />
                Счёт № {done.orderId} на {rub(done.amountRub)} выставлен
              </div>
              <p className="mt-2 text-[14px] leading-[1.6] text-[#3c4053]">
                Покупатель — {done.buyerName}. PDF отправили на {email}
                {done.dueAt ? `, оплатить нужно до ${new Date(done.dueAt).toLocaleDateString("ru-RU")}` : ""}. Когда деньги
                придут, пришлём на эту почту ссылку для входа в кабинет — тариф подключится сам.
              </p>
              <a
                href={done.pdfUrl}
                className="mt-4 inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
              >
                <Download className="size-4" aria-hidden />
                Скачать счёт PDF
              </a>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <label htmlFor={`${ids}-inn`} className="block text-[13px] font-medium text-[#0b1024]">ИНН организации или ИП</label>
              <input
                id={`${ids}-inn`}
                inputMode="numeric"
                autoComplete="off"
                value={inn}
                onChange={(event) => {
                  setInn(event.target.value.replace(/\D/g, "").slice(0, 12));
                  setFound(null);
                }}
                onBlur={(event) => void lookup(event.target.value)}
                placeholder="10 или 12 цифр"
                className={INPUT}
              />
              {found ? <p className="mt-1.5 text-[13px] text-[#136b2a]">{found}</p> : null}
              {needName ? (
                <>
                  <label htmlFor={`${ids}-name`} className="mt-3 block text-[13px] font-medium text-[#0b1024]">Название, как в документах</label>
                  <input id={`${ids}-name`} value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="ООО «Ромашка»" className={INPUT} />
                </>
              ) : null}
              <label htmlFor={`${ids}-email`} className="mt-3 block text-[13px] font-medium text-[#0b1024]">Почта — на неё придёт счёт</label>
              <input
                id={`${ids}-email`}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                placeholder="buh@company.ru"
                className={INPUT}
              />
              {error ? <p role="alert" className="mt-3 rounded-2xl bg-[#fff4f2] px-4 py-2.5 text-[13.5px] text-[#a13a32]">{error}</p> : null}
              <button
                type="submit"
                disabled={busy || !plan}
                className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[#5566f6] bg-white px-5 text-[15px] font-medium text-[#3848c7] transition-colors hover:bg-[#f5f6ff] disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileText className="size-4" aria-hidden />}
                Выставить счёт на {rub(expectedGrossRub)}
              </button>
              <p className="mt-3 text-[12px] leading-[1.6] text-[#9b9fb3]">
                Нажимая «Выставить счёт», вы принимаете условия{" "}
                <Link href="/oferta" className="text-[#3848c7]">договора-оферты</Link> и{" "}
                <Link href="/privacy" className="text-[#3848c7]">политики конфиденциальности</Link>, а также даёте{" "}
                <Link href="/consent" className="text-[#3848c7]">согласие на обработку персональных данных</Link>.
              </p>
            </form>
          )}
        </div>
      ) : null}
    </section>
  );
}
