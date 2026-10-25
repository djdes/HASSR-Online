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
 * «Оплата по безналу для юрлиц» на странице тарифа.
 *
 * Счёт — для тех, кто не платит картой: бухгалтерия переводит по
 * реквизитам, ROOT отмечает поступление, дальше всё как после кассы.
 * Один действующий счёт на организацию: пока он не оплачен и не
 * отменён, карточка показывает его, а не кнопку.
 *
 * Тариф счёта выбирается из вариантов, которые можно оплатить сейчас
 * (продление, повышение, переход на год); сумму по виду перехода считает
 * сервер — здесь она только для показа, в запрос уходят тариф и точки.
 */
type Pending = { id: number; amountRub: number; dueAt: string | null };

export type InvoiceOption = {
  key: string;
  /** «Стандарт · оплата за год · 1 точка». */
  label: string;
  tier: "standard" | "premium";
  cycle: "month" | "year";
  points: number;
  /** К оплате по виду перехода, без акции и скидки. */
  amountRub: number;
};

export function InvoiceCard({
  ready,
  orgName,
  orgInn,
  options,
  defaultKey,
  pending,
  promotion = null,
  discount = null,
  promoCode = null,
}: {
  /** Реквизиты исполнителя заполнены — счёт можно выставить. */
  ready: boolean;
  orgName: string;
  orgInn: string | null;
  options: InvoiceOption[];
  defaultKey: string;
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
  const [selectedKey, setSelectedKey] = useState(defaultKey);
  // Сумма, которую сервер назвал при отказе «сумма изменилась»: её и
  // показываем, и сверяем при следующем нажатии.
  const [serverTotal, setServerTotal] = useState<{ key: string; rub: number } | null>(null);
  const option = options.find((item) => item.key === selectedKey) ?? options[0];
  if (!ready || !option) return null;

  const rub = (value: number) => `${value.toLocaleString(locale)} ₽`;
  const price = applyPromotion(option.amountRub, promotion);
  const totalRub =
    serverTotal?.key === option.key
      ? serverTotal.rub
      : Math.max(0, price.priceRub - (discount ? discountForPrice(discount, price.priceRub) : 0));

  async function issue() {
    setBusy(true);
    try {
      const response = await fetch("/api/payments/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: option.tier,
          cycle: option.cycle,
          points: option.points,
          ...(promoCode ? { promoCode } : {}),
          // Сверка с суммой на экране: сервер считает сам и откажет, если она изменилась.
          expectedGrossRub: totalRub,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string; orderId?: number; pdfUrl?: string; grossRub?: number }
        | null;
      if (typeof data?.grossRub === "number") setServerTotal({ key: option.key, rub: data.grossRub });
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
                        // Срок счёта — по Москве, как в PDF и письме (и без расхождения с сервером).
                        date: new Date(pending.dueAt).toLocaleDateString(locale, { timeZone: "Europe/Moscow" }),
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
              {options.length > 1 ? (
                <label className="mt-3 flex max-w-[480px] flex-col gap-1.5 text-[12.5px] font-medium text-[#6f7282]">
                  {t("planLabel")}
                  <select
                    value={option.key}
                    onChange={(event) => setSelectedKey(event.target.value)}
                    data-testid="invoice-plan"
                    className="h-11 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[14px] font-normal text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                  >
                    {options.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-[#6f7282]">
                {t.rich("offerText", {
                  price: () => (
                    <PromoPrice price={price} personal={discount} size="text" tone="inherit" />
                  ),
                  plan: option.label,
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
