"use client";

import { Building2, FileText } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PromoPrice, type PersonalDiscount } from "@/components/pricing/promo-price";
import { discountForPrice, discountLabel } from "@/lib/promo/discounts";
import { applyPromotion, type AppliedPromotion } from "@/lib/promo/promotions";

/**
 * «Оплата по безналу для юрлиц» на странице подписки.
 *
 * Счёт — для тех, кто не платит картой: бухгалтерия переводит по
 * реквизитам, ROOT отмечает поступление, дальше всё как после кассы.
 * Один действующий счёт на организацию: пока он не оплачен и не
 * отменён, карточка показывает его, а не кнопку.
 */
type Pending = { id: number; amountRub: number; dueAt: string | null };

export function InvoiceCard({
  ready,
  orgName,
  orgInn,
  amountRub,
  periodDays,
  pending,
  promotion = null,
  discount = null,
  promoCode = null,
}: {
  /** Реквизиты исполнителя заполнены — счёт можно выставить. */
  ready: boolean;
  orgName: string;
  orgInn: string | null;
  /** Цена подписки по тарифу (без акции). */
  amountRub: number;
  periodDays: number;
  pending: Pending | null;
  /** Действующая акция: счёт выставится по цене со скидкой (сервер считает так же). */
  promotion?: AppliedPromotion | null;
  /** Промокод или скидка навсегда поверх акции (сервер, `resolveCheckoutDiscount`). */
  discount?: PersonalDiscount | null;
  /** Введённый код — уходит в запрос, сумму сервер пересчитает сам. */
  promoCode?: string | null;
}) {
  const t = useTranslations("settingsUi.invoiceCard");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ready) return null;

  const rub = (value: number) => `${value.toLocaleString(locale)} ₽`;
  const price = applyPromotion(amountRub, promotion);
  const totalRub = Math.max(0, price.priceRub - (discount ? discountForPrice(discount, price.priceRub) : 0));

  async function issue() {
    setBusy(true);
    try {
      const response = await fetch("/api/payments/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tariffKey: "monthly", ...(promoCode ? { promoCode } : {}) }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string; orderId?: number; pdfUrl?: string } | null;
      if (!response.ok || !data?.orderId) throw new Error(data?.error ?? t("issueFailed"));
      toast.success(t("issued", { id: data.orderId }));
      if (data.pdfUrl) window.open(data.pdfUrl, "_blank", "noopener");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <Building2 className="size-5" />
        </span>
        <div className="flex-1">
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {t("title")}
          </h2>
          {pending ? (
            <>
              <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-[#6f7282]">
                {t("pendingText", {
                  id: pending.id,
                  amount: rub(pending.amountRub),
                  due: pending.dueAt
                    ? t("dueSuffix", {
                        date: new Date(pending.dueAt).toLocaleDateString(locale),
                      })
                    : "",
                })}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`/api/payments/invoice/${pending.id}/pdf`}
                  className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                >
                  <FileText className="size-4 text-[#5566f6]" />
                  {t("downloadPdf")}
                </a>
                <span className="inline-flex h-10 items-center rounded-2xl bg-[#fff8eb] px-3 text-[13px] font-medium text-[#b25f00]">
                  {t("awaitingPayment")}
                </span>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-[#6f7282]">
                {t.rich("offerText", {
                  price: () => (
                    <PromoPrice price={price} personal={discount} size="text" tone="inherit" />
                  ),
                  periodDays,
                  orgName,
                  inn: orgInn ? t("innParen", { inn: orgInn }) : "",
                  org: (chunks) => <strong className="text-[#0b1024]">{chunks}</strong>,
                })}
              </p>
              {!orgInn ? (
                <p className="mt-2 text-[13px] text-[#b25f00]">
                  {t.rich("innRequired", {
                    link: (chunks) => (
                      <Link href="/settings/organization" className="underline underline-offset-2">
                        {chunks}
                      </Link>
                    ),
                  })}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(true)}
                disabled={!orgInn}
                className="mt-3 inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50"
              >
                <FileText className="size-4 text-[#5566f6]" />
                {t("issueInvoice")}
              </button>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={issue}
        variant="info"
        title={t("confirmTitle", { amount: rub(totalRub) })}
        description={t("confirmDescription", {
          orgName,
          inn: orgInn ? t("confirmInn", { inn: orgInn }) : "",
        })}
        bullets={[
          ...(discount ? [{ label: t("bulletDiscount", { label: discountLabel(discount) }) }] : []),
          { label: t("bulletPdf") },
          { label: t("bulletExtend") },
          { label: t("bulletUpd") },
        ]}
        confirmLabel={busy ? t("issuing") : t("issueInvoice")}
        confirmDisabled={busy}
      />
    </section>
  );
}
