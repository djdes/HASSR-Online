"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, CreditCard, FileText, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  TOPUP_MAX_RUB,
  TOPUP_MIN_RUB,
  TOPUP_PRESETS_RUB,
  formatPoints,
  parseTopupAmount,
} from "@/lib/balance/constants";
import type { TopupBlockConfig } from "@/lib/balance/topup-core";
import { useRobokassaScript } from "@/lib/use-robokassa-script";

import {
  Section,
  inputClass,
  miniInput,
  miniPrimary,
  miniSecondary,
  primaryButtonClass,
  secondaryButtonClass,
} from "./balance-ui";

/**
 * «Пополнить баланс» — деньги на баланс организации, 1 ₽ = 1 балл.
 *
 * Сумма — кнопки 1 990 / 5 000 / 10 000 ₽ или своя, от 500 до 300 000 ₽
 * целыми рублями. Браузер сумму только показывает: заказ и сумму
 * проверяет сервер (`POST /api/balance/topup`), зачисляет — подтверждение
 * оплаты (касса или ROOT по счёту). Картой — iFrame Робокассы, как на
 * оформлении подписки; не поднялся скрипт — обычная форма кассы. Счёт —
 * для юрлиц, если реквизиты WeSetup заполнены.
 *
 * Блок рендерится только у руководителя, который видит баланс, и не в
 * приложении WeSetup — решает сервер (страница «Баланс и бонусы»).
 */
type Watch = { invId: number; psig: string; amountRub: number };

export function TopupSection({
  config,
  mini,
  onPaid,
}: {
  config: TopupBlockConfig;
  mini: boolean;
  /** Оплата подтверждена — перечитать баланс и историю. */
  onPaid: () => void | Promise<void>;
}) {
  const t = useTranslations("settingsManagement.balanceTopup");
  const locale = useLocale();
  const router = useRouter();
  const [input, setInput] = useState<string>(String(TOPUP_PRESETS_RUB[0]));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<"card" | "invoice" | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watch, setWatch] = useState<Watch | null>(null);
  const [paid, setPaid] = useState<{ amountRub: number; invId: number } | null>(null);
  const scriptReady = useRobokassaScript();

  const check = useMemo(() => parseTopupAmount(input), [input]);
  const amountRub = check.ok ? check.amountRub : null;
  const hint = !touched || check.ok
    ? null
    : check.code === "minimum"
      ? t("validation.minimum", { amount: TOPUP_MIN_RUB })
      : check.code === "maximum"
        ? t("validation.maximum", { amount: TOPUP_MAX_RUB })
        : check.code === "wholeRubles"
          ? t("validation.wholeRubles")
          : check.code === "numeric"
            ? t("validation.numeric")
            : t("validation.required");

  // Пока человек платит в iFrame, следим за заказом: возврат на SuccessURL
  // происходит внутри рамки, и без опроса блок так и остался бы формой.
  useEffect(() => {
    if (!watch) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/payments/robokassa/status?invId=${watch.invId}&psig=${encodeURIComponent(watch.psig)}`,
        );
        if (res.ok) {
          const data = (await res.json()) as { status: string };
          if (data.status === "paid" || data.status === "completed") {
            if (!stopped) {
              setPaid({ amountRub: watch.amountRub, invId: watch.invId });
              setWatch(null);
              void onPaid();
            }
            return;
          }
          if (data.status !== "pending") {
            if (!stopped) {
              setWatch(null);
              setError(t("paymentClosed"));
            }
            return;
          }
        }
      } catch {
        /* сеть моргнула — пробуем ещё раз */
      }
      // Полчаса без ответа — перестаём ждать: заказ оплатят позже —
      // баланс всё равно пополнится, а письмо придёт.
      if (!stopped && Date.now() - startedAt < 30 * 60 * 1000) timer = setTimeout(tick, 3000);
    };
    timer = setTimeout(tick, 3000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [watch, onPaid, t]);

  async function create(method: "card" | "invoice") {
    setTouched(true);
    if (!amountRub) return;
    setError(null);
    setBusy(method);
    try {
      const res = await fetch("/api/balance/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountRub, method }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        invId?: number;
        params?: Record<string, string>;
        paymentUrl?: string;
        orderId?: number;
        pdfUrl?: string;
        created?: boolean;
      };
      if (!res.ok) {
        setError(t("createFailed"));
        setInvoiceOpen(false);
        return;
      }
      if (method === "invoice") {
        toast.success(
          data.created === false
            ? t("invoicePdfNotice")
            : t("invoiceCreditNotice"),
        );
        if (data.pdfUrl) window.open(data.pdfUrl, "_blank", "noopener");
        setInvoiceOpen(false);
        router.refresh();
        return;
      }
      if (!data.params || !data.invId) {
        setError(t("openFailed"));
        return;
      }
      if (scriptReady && window.Robokassa) {
        window.Robokassa.StartPayment(data.params);
        setWatch({ invId: data.invId, psig: data.params.SignatureValue, amountRub });
        return;
      }
      if (data.paymentUrl) window.location.href = data.paymentUrl;
    } catch {
      setError(t("networkError"));
    } finally {
      setBusy(null);
    }
  }

  const pending = config.pendingInvoice;
  const muted = mini ? { color: "var(--mini-text-muted)" } : undefined;

  return (
    <Section
      mini={mini}
      icon={<Wallet className={mini ? "size-5" : "size-5 text-[#3848c7]"} />}
      title={t("title")}
      subtitle={t("subtitle")}
    >
      <div data-testid="topup-section">
        {paid ? (
          <div
            data-testid="topup-paid"
            className={
              mini
                ? "mb-4 flex items-start gap-2.5 rounded-2xl p-4 text-[13.5px]"
                : "mb-4 flex items-start gap-2.5 rounded-2xl bg-[#ecfdf5] px-4 py-3 text-[13.5px] text-[#116b2a]"
            }
            style={mini ? { background: "var(--mini-sage-soft)", color: "var(--mini-sage)" } : undefined}
          >
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
            <span>
              {t("paymentReceived", { amount: paid.amountRub, invoiceId: String(paid.invId) })}
            </span>
          </div>
        ) : null}

        <div
          className={mini ? "text-[12px] font-medium" : "text-[12px] font-medium uppercase tracking-[0.14em] text-[#6f7282]"}
          style={muted}
        >
          {t("amountLabel")}
        </div>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={t("quickAmountLabel")}>
          {TOPUP_PRESETS_RUB.map((preset) => {
            const active = amountRub === preset;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setInput(String(preset));
                  setTouched(false);
                  setError(null);
                }}
                className={
                  mini
                    ? "inline-flex h-10 items-center rounded-2xl px-4 text-[14px] font-medium tabular-nums"
                    : `inline-flex h-10 items-center rounded-2xl px-4 text-[14px] font-medium tabular-nums transition-colors ${
                        active
                          ? "bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)]"
                          : "border border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                      }`
                }
                style={mini ? (active ? miniPrimary : miniSecondary) : undefined}
              >
                {formatPoints(preset)}
              </button>
            );
          })}
        </div>

        <label
          htmlFor="topup-amount"
          className={mini ? "mt-4 block text-[13px] font-medium" : "mt-4 block text-[13px] font-medium text-[#0b1024]"}
          style={mini ? { color: "var(--mini-text)" } : undefined}
        >
          {t("customAmountLabel")}
        </label>
        <input
          id="topup-amount"
          inputMode="numeric"
          autoComplete="off"
          value={input}
          onChange={(event) => {
            setInput(event.target.value.replace(/[^\d\s]/g, "").slice(0, 9));
            setTouched(true);
            setError(null);
          }}
          onBlur={() => setTouched(true)}
          aria-invalid={Boolean(hint)}
          aria-describedby="topup-amount-hint"
          className={`${inputClass(mini)} mt-2 max-w-[260px] tabular-nums`}
          style={mini ? miniInput : undefined}
        />
        <p
          id="topup-amount-hint"
          className={hint ? "mt-1.5 text-[12.5px] text-[#a13a32]" : mini ? "mt-1.5 text-[12.5px]" : "mt-1.5 text-[12.5px] text-[#9b9fb3]"}
          style={hint ? undefined : mini ? { color: "var(--mini-text-faint)" } : undefined}
        >
          {hint ?? t("amountRange", { min: TOPUP_MIN_RUB, max: TOPUP_MAX_RUB })}
        </p>

        <div
          className={
            mini
              ? "mt-4 flex flex-wrap items-baseline justify-between gap-2 rounded-2xl p-4"
              : "mt-4 flex flex-wrap items-baseline justify-between gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4"
          }
          style={mini ? { background: "var(--mini-surface-2)" } : undefined}
        >
          <span className={mini ? "text-[13px]" : "text-[13.5px] text-[#3c4053]"} style={muted}>
            {t("totalDue")}
          </span>
          <span
            data-testid="topup-total"
            className={mini ? "text-[20px] font-semibold tabular-nums" : "text-[22px] font-semibold tabular-nums tracking-[-0.01em] text-[#0b1024]"}
            style={mini ? { color: "var(--mini-text)" } : undefined}
          >
            {amountRub ? formatPoints(amountRub) : "—"}
          </span>
          <span className="w-full text-[12.5px] text-[#116b2a]">
            {amountRub ? t("creditedAmount", { amount: amountRub }) : " "}
          </span>
        </div>

        {error ? (
          <p className="mt-3 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {config.cardReady ? (
            <button
              type="button"
              data-testid="topup-card"
              disabled={busy !== null || Boolean(watch)}
              onClick={() => void create("card")}
              className={primaryButtonClass(mini)}
              style={mini ? miniPrimary : undefined}
            >
              {busy === "card" ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
              {t("payByCard")}
            </button>
          ) : null}
          {config.invoiceReady && !pending ? (
            <button
              type="button"
              data-testid="topup-invoice"
              disabled={busy !== null || !config.organizationInn}
              onClick={() => {
                setTouched(true);
                if (amountRub) setInvoiceOpen(true);
              }}
              className={secondaryButtonClass(mini)}
              style={mini ? miniSecondary : undefined}
            >
              {busy === "invoice" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
              {t("issueInvoice")}
            </button>
          ) : null}
        </div>

        {watch ? (
          <p className="mt-3 flex items-center gap-2 text-[13px] text-[#6f7282]" style={muted}>
            <Loader2 className="size-3.5 animate-spin text-[#5566f6]" />
            {t("waitingPayment")}
          </p>
        ) : null}

        {config.recurringActive ? (
          <p
            className={
              mini
                ? "mt-3 rounded-2xl p-3 text-[12.5px] leading-[1.5]"
                : "mt-3 rounded-2xl bg-[#fff8eb] px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-[#a16d32]"
            }
            style={mini ? { background: "var(--mini-surface-2)", color: "var(--mini-text-muted)" } : undefined}
          >
            {t("recurringActive")}
          </p>
        ) : null}

        {!config.cardReady ? (
          <p className="mt-3 text-[13px] text-[#6f7282]" style={muted}>
            {t("cardUnavailable", { invoiceHint: config.invoiceReady ? t("invoiceHint") : "" })}
          </p>
        ) : null}

        {config.invoiceReady && !pending && !config.organizationInn ? (
          <p className="mt-3 text-[13px] text-[#b25f00]">
            {t("innRequired")} {" "}
            <Link href="/settings/organization" className="underline underline-offset-2">
              {t("setInn")}
            </Link>
            .
          </p>
        ) : null}

        {pending ? (
          <div
            data-testid="topup-pending-invoice"
            className={
              mini
                ? "mt-4 rounded-2xl p-4 text-[13.5px]"
                : "mt-4 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[13.5px] leading-relaxed text-[#3c4053]"
            }
            style={mini ? { background: "var(--mini-surface-2)", color: "var(--mini-text)" } : undefined}
          >
            {t("invoicePending", {
              invoiceId: String(pending.id),
              amount: pending.amountRub,
              dueDatePart: pending.dueAt ? t("dueDatePart", { date: new Date(pending.dueAt).toLocaleDateString(locale) }) : "",
            })}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href={`/api/payments/invoice/${pending.id}/pdf`}
                className={secondaryButtonClass(mini)}
                style={mini ? miniSecondary : undefined}
              >
                <FileText className="size-4" />
                {t("downloadInvoice")}
              </a>
              <span className="inline-flex h-10 items-center rounded-2xl bg-[#fff8eb] px-3 text-[13px] font-medium text-[#b25f00]">
                {t("waitingInvoicePayment")}
              </span>
            </div>
          </div>
        ) : null}

        <p
          className={mini ? "mt-4 flex items-start gap-2 text-[12px] leading-[1.6]" : "mt-4 flex items-start gap-2 text-[12px] leading-[1.6] text-[#9b9fb3]"}
          style={mini ? { color: "var(--mini-text-faint)" } : undefined}
        >
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
          <span>
            {t("paymentDisclosure")} {" "}
            <Link href="/oferta" className="text-[#3848c7]">
              {t("offer")}
            </Link>
            .
          </span>
        </p>
      </div>

      <ConfirmDialog
        open={invoiceOpen}
        onClose={() => setInvoiceOpen(false)}
        onConfirm={() => create("invoice")}
        variant="info"
        title={t("invoiceConfirmTitle", { amount: String(amountRub ?? "—") })}
        description={t("invoiceConfirmDescription", {
          organizationName: config.organizationName,
          innPart: config.organizationInn ? t("invoiceInnPart", { inn: config.organizationInn }) : "",
        })}
        bullets={[
          { label: t("invoicePdfNotice") },
          { label: t("invoiceCreditNotice"), tone: "info" },
          { label: t("noPromoNotice") },
        ]}
        confirmLabel={busy === "invoice" ? t("issuingInvoice") : t("issueInvoice")}
        confirmDisabled={busy !== null}
      />
    </Section>
  );
}
