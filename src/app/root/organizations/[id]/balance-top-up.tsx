"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Banknote, Coins, CreditCard, Landmark, Minus, Plus, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { organizationError } from "./organization-presentation";

const TRIGGER_STYLES = {
  link: "-mr-1.5 mt-1 inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[12.5px] font-medium text-[#3848c7] transition-colors hover:bg-[#f5f6ff] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]/40",
  row: "inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
  regular: "inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
} as const;

type Method = "adjust" | "cash" | "transfer" | "card";

const METHODS = [
  { value: "adjust", icon: SlidersHorizontal, label: "balance.methodAdjust" },
  { value: "cash", icon: Banknote, label: "balance.methodCash" },
  { value: "transfer", icon: Landmark, label: "balance.methodTransfer" },
  { value: "card", icon: CreditCard, label: "balance.methodCard" },
] as const;

const METHOD_PREFIX = { cash: "balance.prefixCash", transfer: "balance.prefixTransfer", card: "balance.prefixCard" } as const;

/**
 * «Пополнить баланс» клиента — одно окно для списка клиентов, шапки и блока
 * баллов карточки (владелец, 2026-11-09: «нету пополнения баланса… всё
 * должно быть одинаково и понятно»). Начислить или списать, сумма, за что;
 * проводка — `POST /api/root/organizations/<id>/balance` (леджер, аудит,
 * уведомление клиенту). Показывается тем, у кого раздел «Оплаты и тарифы».
 */
export function BalanceTopUpButton({
  organizationId,
  organizationName,
  balanceRub,
  size = "row",
}: {
  organizationId: string;
  organizationName: string;
  balanceRub: number;
  /**
   * `link` — под баллами в колонке денег списка; `row` — кнопка карточки
   * списка на телефоне; `regular` — шапка и блок баллов карточки клиента.
   */
  size?: "link" | "row" | "regular";
}) {
  const t = useTranslations("rootOrganizationManagement");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  // Откуда деньги: корректировка баллов или живые деньги мимо кассы
  // (наличные, перевод, карта в терминале) — тогда строка «Пополнение».
  const [method, setMethod] = useState<Method>("adjust");
  const topup = sign > 0 && method !== "adjust";

  const parsedAmount = Number.parseInt(amount, 10);
  const valid = Number.isFinite(parsedAmount) && parsedAmount > 0 && comment.trim().length >= 3;
  const delta = valid ? parsedAmount * sign : 0;

  function close() {
    setOpen(false);
    setSign(1);
    setAmount("");
    setComment("");
    setMethod("adjust");
  }

  async function submit() {
    try {
      const response = await fetch(`/api/root/organizations/${organizationId}/balance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: delta, comment: comment.trim(), method: topup ? method : "adjust" }),
      });
      const body = (await response.json().catch(() => ({}))) as { balanceRub?: number };
      if (!response.ok) {
        toast.error(organizationError(body, t, "balance.failed"));
        return;
      }
      toast.success(
        t(delta > 0 ? "balance.successCredit" : "balance.successDebit", {
          balance: body.balanceRub ?? 0,
          amount: Math.abs(delta),
        }),
      );
      close();
      router.refresh();
    } catch {
      toast.error(t("balance.network"));
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("balance.topUpAria", { name: organizationName })}
        data-balance-top-up={organizationId}
        className={TRIGGER_STYLES[size]}
      >
        {size === "link" ? <Plus className="size-3.5" /> : <Coins className={size === "row" ? "size-3.5 text-[#5566f6]" : "size-5 text-[#5566f6]"} />}
        {size === "regular" ? t("balance.topUpLong") : t("balance.topUp")}
      </button>

      <ConfirmDialog
        open={open}
        onClose={close}
        onConfirm={submit}
        icon={Coins}
        title={t("balance.topUpTitle")}
        description={t("balance.topUpDescription", { name: organizationName, balance: balanceRub })}
        bullets={[
          ...(comment.trim().length >= 3
            ? [
                {
                  label:
                    topup
                      ? t("balance.methodTopupNotice", { prefix: t(METHOD_PREFIX[method]), comment: comment.trim() })
                      : t("balance.commentNotice", { comment: comment.trim() }),
                },
              ]
            : []),
          ...(topup && method === "transfer" ? [{ label: t("balance.transferHint"), tone: "warn" as const }] : []),
          { label: t("balance.auditNotice"), tone: "info" as const },
          ...(sign < 0 ? [{ label: t("balance.debitNotice"), tone: "warn" as const }] : []),
        ]}
        cancelLabel={t("common.cancel")}
        confirmLabel={sign > 0 ? t("balance.credit") : t("balance.debit")}
        variant={sign > 0 ? "default" : "danger"}
        confirmDisabled={!valid}
      >
        <div className="space-y-3" data-balance-top-up-form>
          <div className="inline-flex overflow-hidden rounded-2xl border border-[#dcdfed]">
            <button
              type="button"
              onClick={() => setSign(1)}
              aria-pressed={sign === 1}
              className={`inline-flex h-11 items-center gap-1.5 px-4 text-[14px] font-medium transition-colors ${
                sign === 1 ? "bg-[#5566f6] text-white" : "bg-white text-[#0b1024] hover:bg-[#f5f6ff]"
              }`}
            >
              <Plus className="size-4" />
              {t("balance.credit")}
            </button>
            <button
              type="button"
              onClick={() => setSign(-1)}
              aria-pressed={sign === -1}
              className={`inline-flex h-11 items-center gap-1.5 px-4 text-[14px] font-medium transition-colors ${
                sign === -1 ? "bg-[#a13a32] text-white" : "bg-white text-[#0b1024] hover:bg-[#fff4f2]"
              }`}
            >
              <Minus className="size-4" />
              {t("balance.debit")}
            </button>
          </div>
          {sign > 0 ? (
            <div role="radiogroup" aria-label={t("balance.methodLabel")} className="space-y-1.5" data-balance-method>
              <div className="text-[12.5px] font-medium text-[#6f7282]">{t("balance.methodLabel")}</div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {METHODS.map(({ value, icon: Icon, label }) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={method === value}
                    onClick={() => setMethod(value)}
                    className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border px-2 text-[13px] font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
                      method === value
                        ? "border-[#5566f6] bg-[#f5f6ff] text-[#3848c7]"
                        : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                    }`}
                  >
                    <Icon className="size-4" />
                    {t(label)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <input
            aria-label={t("balance.amountLabel")}
            inputMode="numeric"
            autoFocus
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, "").slice(0, 7))}
            placeholder={t("balance.amountPlaceholder")}
            data-balance-amount
            className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] tabular-nums text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
          <input
            aria-label={t("balance.commentLabel")}
            value={comment}
            onChange={(event) => setComment(event.target.value.slice(0, 300))}
            placeholder={t("balance.commentPlaceholder")}
            data-balance-comment
            className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
          {valid ? (
            <p className="text-[13px] font-medium tabular-nums text-[#3c4053]" data-balance-after>
              {t("balance.after", { amount: balanceRub + delta })}
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </>
  );
}
