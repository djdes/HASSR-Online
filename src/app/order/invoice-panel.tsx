"use client";

import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Building2, CheckCircle2, Download, FileText, Loader2, Mail } from "lucide-react";

import { useRegistrationChallenge } from "@/components/auth/registration-challenge";
import { PAYMENT_GOALS } from "@/lib/payment-goals";
import { ymGoal } from "@/lib/signup-source";

/**
 * «Счёт для юрлица или ИП» на /order — выбирается в списке «Способ оплаты»
 * (спека checkout-conversion-2026-11-22; раньше — свёрнутая панель только для
 * гостя, 2026-11-01).
 *
 *  - Гость: ИНН (подсказка из ЕГРЮЛ), название, если ЕГРЮЛ не нашёл, почта.
 *    Счёт без регистрации: `/api/payments/invoice/guest`.
 *  - Руководитель: счёт на свою организацию (`/api/payments/invoice`). Нет ИНН —
 *    вводит его здесь же, сервер запишет его в реквизиты и выставит счёт.
 *
 * После выставления — номер, срок, «Скачать PDF» и «Отправить на другую почту»
 * (бухгалтеру): письмо с PDF на почту заказа уже ушло.
 */

export type OrderOrgInvoice = {
  /** Название покупателя в счёте: ЕГРЮЛ, юридическое название или название кабинета. */
  buyerName: string;
  inn: string | null;
};

type Done = {
  orderId: number;
  amountRub: number;
  dueAt: string | null;
  buyerName: string;
  pdfUrl: string;
  email: string;
  created: boolean;
};

const INPUT =
  "mt-1.5 h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const LABEL = "block text-[13px] font-medium text-[#0b1024]";

function rub(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
}

function signatureOf(pdfUrl: string): string | null {
  try {
    return new URL(pdfUrl, "https://wesetup.ru").searchParams.get("sig");
  } catch {
    return null;
  }
}

export function InvoicePanel({
  email,
  onEmailChange,
  plan,
  promoCode,
  expectedGrossRub,
  org = null,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  plan: { tier: string; cycle: string; points: number };
  promoCode: string | null;
  expectedGrossRub: number;
  /** Вошедший руководитель: счёт на его организацию. null — гость. */
  org?: OrderOrgInvoice | null;
}) {
  const t = useTranslations("orderCheckout");
  const ids = useId();
  const guest = !org;
  const needInn = guest || !org?.inn;
  const [inn, setInn] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [found, setFound] = useState<string | null>(null);
  const [needName, setNeedName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  // Счёт без входа — только после невидимой проверки от ботов (боты рассылали бы счета).
  const challenge = useRegistrationChallenge();

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
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const common = {
        plan: plan.tier,
        cycle: plan.cycle,
        points: plan.points,
        promoCode: promoCode ?? undefined,
        expectedGrossRub,
      };
      const response = guest
        ? await fetch("/api/payments/invoice/guest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...common,
              inn,
              email,
              companyName: companyName || undefined,
              captchaToken: await challenge.getToken(),
              website: challenge.website,
            }),
          })
        : await fetch("/api/payments/invoice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...common, ...(needInn ? { buyer: { inn, companyName: companyName || undefined } } : {}) }),
          });
      const data = (await response.json().catch(() => ({}))) as Partial<Done> & { error?: string; code?: string };
      if (!response.ok || typeof data.orderId !== "number") {
        if (data.code === "name-required") setNeedName(true);
        setError(data.error ?? t("invoice.failed"));
        return;
      }
      ymGoal(PAYMENT_GOALS.invoice, { plan: `${plan.tier}_${plan.cycle}` });
      setDone({
        orderId: data.orderId,
        amountRub: data.amountRub ?? expectedGrossRub,
        dueAt: data.dueAt ?? null,
        buyerName: data.buyerName ?? found ?? (companyName.trim() || org?.buyerName || ""),
        pdfUrl: data.pdfUrl ?? "",
        email: data.email ?? email,
        created: data.created !== false,
      });
    } catch {
      setError(t("offline"));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <InvoiceDone done={done} guest={guest} />;

  return (
    <form id="invoice" onSubmit={submit} noValidate className="mt-5 scroll-mt-24" data-invoice-panel={guest ? "guest" : "org"}>
      {org?.inn ? (
        <div className="flex items-start gap-3 rounded-2xl bg-[#f4f5fb] px-4 py-3" data-invoice-buyer>
          <Building2 className="mt-0.5 size-4 shrink-0 text-[#5566f6]" aria-hidden />
          <div className="min-w-0 flex-1 text-[14px] leading-[1.5] text-[#0b1024]">
            <span className="text-[#6f7282]">{t("invoice.buyer")}: </span>
            <span className="font-medium">{org.buyerName}</span>
            <span className="text-[#6f7282]"> · {t("invoice.buyerInn", { inn: org.inn })}</span>
            <Link href="/settings/organization" className="ml-2 whitespace-nowrap text-[13px] text-[#3848c7] underline-offset-4 hover:underline">
              {t("invoice.otherRequisites")}
            </Link>
          </div>
        </div>
      ) : (
        <>
          {org ? <p className="mb-3 text-[13px] leading-[1.5] text-[#7a4a00]">{t("invoice.innMissing")}</p> : null}
          <label htmlFor={`${ids}-inn`} className={LABEL}>
            {t("invoice.inn")}
          </label>
          <input
            id={`${ids}-inn`}
            inputMode="numeric"
            autoComplete="off"
            value={inn}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "").slice(0, 12);
              setInn(digits);
              setFound(null);
              // 12 цифр — ИП, длиннее не бывает; 10 — может быть началом ИНН ИП: ждём ухода с поля.
              if (digits.length === 12) void lookup(digits);
            }}
            onBlur={(event) => void lookup(event.target.value)}
            placeholder={t("invoice.innPlaceholder")}
            className={INPUT}
          />
          {found ? (
            <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-[#136b2a]">
              <CheckCircle2 className="size-3.5" aria-hidden />
              {found}
            </p>
          ) : null}
          {needName ? (
            <>
              <label htmlFor={`${ids}-name`} className={`mt-3 ${LABEL}`}>
                {t("invoice.name")}
              </label>
              <input
                id={`${ids}-name`}
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                placeholder={t("invoice.namePlaceholder")}
                className={INPUT}
              />
            </>
          ) : null}
        </>
      )}

      {guest ? (
        <>
          <label htmlFor={`${ids}-email`} className={`mt-4 ${LABEL}`}>
            {t("email.invoiceLabel")}
          </label>
          <input
            id={`${ids}-email`}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            placeholder="buh@company.ru"
            className={INPUT}
          />
          {challenge.element}
        </>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-2xl bg-[#fff4f2] px-4 py-2.5 text-[13.5px] text-[#a13a32]">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        data-invoice-submit
        className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileText className="size-4" aria-hidden />}
        {busy ? t("invoice.issuing") : t("invoice.issue", { amount: rub(expectedGrossRub) })}
      </button>
      <p className="mt-3 text-[12px] leading-[1.6] text-[#9b9fb3]">
        {t.rich("invoice.consent", {
          oferta: (chunks) => (
            <Link href="/oferta" className="text-[#3848c7]">
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link href="/privacy" className="text-[#3848c7]">
              {chunks}
            </Link>
          ),
          consent: (chunks) => (
            <Link href="/consent" className="text-[#3848c7]">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </form>
  );
}

/** Счёт выставлен: скачать, на какую почту ушёл, переслать бухгалтеру. */
function InvoiceDone({ done, guest }: { done: Done; guest: boolean }) {
  const t = useTranslations("orderCheckout");
  const ids = useId();
  const [sendOpen, setSendOpen] = useState(false);
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const due = done.dueAt ? new Date(done.dueAt).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" }) : null;

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || !to.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const response = await fetch(`/api/payments/invoice/${done.orderId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: to.trim(), ...(guest ? { sig: signatureOf(done.pdfUrl) } : {}) }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; email?: string };
      if (!response.ok) {
        setSendError(data.error ?? t("invoice.sendFailed"));
        return;
      }
      setSentTo(data.email ?? to.trim());
      setTo("");
      setSendOpen(false);
    } catch {
      setSendError(t("offline"));
    } finally {
      setSending(false);
    }
  }

  return (
    <section id="invoice" className="mt-5 scroll-mt-24 rounded-2xl bg-[#ecfdf5] p-5" data-invoice-done>
      <div className="flex items-center gap-2 text-[16px] font-semibold text-[#116b2a]">
        <CheckCircle2 className="size-5 shrink-0" aria-hidden />
        {t("invoice.issued", { number: String(done.orderId), amount: rub(done.amountRub) })}
      </div>
      <p className="mt-2 text-[14px] leading-[1.6] text-[#3c4053]">
        {done.buyerName ? `${t("invoice.issuedBuyer", { buyer: done.buyerName })} ` : null}
        {due ? `${t("invoice.due", { date: due })} ` : null}
        {done.created ? `${t("invoice.sentTo", { email: done.email })} ` : `${t("invoice.alreadyIssued")} `}
        {guest ? t("invoice.afterPayGuest") : t("invoice.afterPayOrg")}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={done.pdfUrl}
          className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
        >
          <Download className="size-4" aria-hidden />
          {t("invoice.download")}
        </a>
        {!sendOpen ? (
          <button
            type="button"
            onClick={() => setSendOpen(true)}
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:bg-[#f5f6ff]"
          >
            <Mail className="size-4 text-[#5566f6]" aria-hidden />
            {t("invoice.sendOther")}
          </button>
        ) : null}
      </div>
      {sendOpen ? (
        <form onSubmit={send} className="mt-3 flex gap-2" noValidate>
          <label htmlFor={`${ids}-to`} className="sr-only">
            {t("invoice.sendOther")}
          </label>
          <input
            id={`${ids}-to`}
            type="email"
            autoComplete="email"
            autoFocus
            value={to}
            onChange={(event) => setTo(event.target.value)}
            placeholder={t("invoice.sendPlaceholder")}
            className="h-11 min-w-0 flex-1 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
          <button
            type="submit"
            disabled={sending || !to.trim()}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:opacity-50"
          >
            {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {sending ? t("invoice.sending") : t("invoice.send")}
          </button>
        </form>
      ) : null}
      {sentTo ? (
        <p className="mt-2 flex items-center gap-1.5 text-[13px] text-[#116b2a]" data-invoice-sent>
          <CheckCircle2 className="size-3.5" aria-hidden />
          {t("invoice.sent", { email: sentTo })}
        </p>
      ) : null}
      {sendError ? (
        <p role="alert" className="mt-2 text-[13px] text-[#a13a32]">
          {sendError}
        </p>
      ) : null}
    </section>
  );
}
