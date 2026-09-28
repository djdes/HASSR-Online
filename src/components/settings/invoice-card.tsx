"use client";

import { Building2, FileText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PromoPrice } from "@/components/pricing/promo-price";
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
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ready) return null;

  const rub = (value: number) => `${value.toLocaleString("ru-RU")} ₽`;
  const price = applyPromotion(amountRub, promotion);

  async function issue() {
    setBusy(true);
    try {
      const response = await fetch("/api/payments/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tariffKey: "monthly" }),
      });
      const data = (await response.json().catch(() => null)) as { error?: string; orderId?: number; pdfUrl?: string } | null;
      if (!response.ok || !data?.orderId) throw new Error(data?.error ?? "Не удалось выставить счёт");
      toast.success(`Счёт № ${data.orderId} выставлен — PDF скачивается, копия ушла на почту`);
      if (data.pdfUrl) window.open(data.pdfUrl, "_blank", "noopener");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
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
            Оплата по безналу для юрлиц
          </h2>
          {pending ? (
            <>
              <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-[#6f7282]">
                Счёт № {pending.id} на {rub(pending.amountRub)} выставлен
                {pending.dueAt ? ` и действителен до ${new Date(pending.dueAt).toLocaleDateString("ru-RU")}` : ""}.
                Как только деньги поступят, подписка продлится автоматически, а закрывающие
                документы появятся в истории оплат ниже.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`/api/payments/invoice/${pending.id}/pdf`}
                  className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                >
                  <FileText className="size-4 text-[#5566f6]" />
                  Скачать счёт (PDF)
                </a>
                <span className="inline-flex h-10 items-center rounded-2xl bg-[#fff8eb] px-3 text-[13px] font-medium text-[#b25f00]">
                  Ждём оплату
                </span>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-[#6f7282]">
                Не платите картой? Выставим счёт на{" "}
                <PromoPrice price={price} size="text" tone="inherit" /> за {periodDays} дн. на{" "}
                <strong className="text-[#0b1024]">{orgName}</strong>
                {orgInn ? ` (ИНН ${orgInn})` : ""}. Бухгалтерия оплачивает по реквизитам, подписка
                продлевается с даты поступления денег, закрывающие документы — автоматически.
              </p>
              {!orgInn ? (
                <p className="mt-2 text-[13px] text-[#b25f00]">
                  Для счёта нужен ИНН организации —{" "}
                  <Link href="/settings/organization" className="underline underline-offset-2">
                    укажите его в настройках
                  </Link>
                  .
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(true)}
                disabled={!orgInn}
                className="mt-3 inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50"
              >
                <FileText className="size-4 text-[#5566f6]" />
                Выставить счёт
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
        title={`Выставить счёт на ${rub(price.priceRub)}?`}
        description={`Плательщик — ${orgName}${orgInn ? `, ИНН ${orgInn}` : ""}. Счёт действителен 7 дней.`}
        bullets={[
          { label: "PDF скачается сразу и уйдёт на вашу почту" },
          { label: "Подписка продлится с даты поступления денег, баллы к счёту не применяются" },
          { label: "УПД появится в истории оплат автоматически" },
        ]}
        confirmLabel={busy ? "Выставляем…" : "Выставить счёт"}
        confirmDisabled={busy}
      />
    </section>
  );
}
