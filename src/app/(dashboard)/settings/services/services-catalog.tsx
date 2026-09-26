"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Lock, Sparkles } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useInsideMobileApp } from "@/lib/use-inside-mobile-app";
import {
  formatServicePrice,
  isInstantPayable,
  type PlatformServiceItem,
  type ServiceCategory,
} from "@/lib/services/constants";

/**
 * Карточки услуг с заказом в один диалог.
 *
 * Диалог всегда объясняет, что именно произойдёт: спишем баллы сейчас
 * или сначала свяжемся и посчитаем. Без этой строки человек не знает,
 * подтверждает он покупку или заявку, и не нажимает ни то, ни другое.
 */
const FIELD_CLASS =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

type Group = {
  category: ServiceCategory;
  label: string;
  items: PlatformServiceItem[];
};

export function ServicesCatalog({
  groups,
  balanceRub,
  canOrder,
  contact,
}: {
  groups: Group[];
  balanceRub: number;
  canOrder: boolean;
  contact: { name: string; phone: string; email: string };
}) {
  const router = useRouter();
  // В приложении WeSetup без слова «оплатить»: правила магазинов про
  // покупки. Услуга всё равно оказывается вне приложения, списываются баллы.
  const insideApp = useInsideMobileApp();
  const [active, setActive] = useState<PlatformServiceItem | null>(null);
  const [form, setForm] = useState(contact);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);

  const price = active?.priceRub ?? 0;
  const payable = active ? isInstantPayable(active) : false;
  const enoughBalance = payable && balanceRub >= price;

  function openService(service: PlatformServiceItem) {
    setActive(service);
    setForm(contact);
    setComment("");
  }

  async function submit() {
    if (!active) return;
    if (form.name.trim().length < 2 || form.phone.trim().length < 6) {
      toast.error("Укажите имя и телефон для связи");
      return;
    }

    setSending(true);
    try {
      const response = await fetch("/api/services/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceKey: active.key,
          contactName: form.name.trim(),
          contactPhone: form.phone.trim(),
          contactEmail: form.email.trim() || undefined,
          comment: comment.trim() || undefined,
          payFromBalance: enoughBalance,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        paidRub?: number;
        paymentSkippedReason?: string | null;
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Не удалось отправить заявку");
      }

      if (data?.paidRub && data.paidRub > 0) {
        toast.success(
          `Оплачено ${data.paidRub.toLocaleString("ru-RU")} ₽ с баланса. Свяжемся с вами в течение рабочего дня`
        );
      } else if (data?.paymentSkippedReason === "insufficient") {
        toast.success(
          "Заявка отправлена. Баллов не хватило, поэтому оплату обсудим отдельно"
        );
      } else {
        toast.success("Заявка отправлена. Свяжемся с вами в течение рабочего дня");
      }

      setActive(null);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось отправить заявку"
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-7">
      {!canOrder ? (
        <div className="flex gap-3 rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4">
          <Lock className="size-4 shrink-0 text-[#6f7282]" />
          <p className="text-[13px] leading-[1.55] text-[#3c4053]">
            Услуги заказывает руководитель организации. Покажите этот раздел
            управляющему или владельцу — они смогут оформить заявку.
          </p>
        </div>
      ) : null}

      {groups.map((group) => (
        <section key={group.category} className="space-y-3">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {group.label}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {group.items.map((service) => {
              const instant = isInstantPayable(service);
              return (
                <div
                  key={service.key}
                  className="flex flex-col rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-shadow duration-150 hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)]"
                >
                  <div className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-[#0b1024]">
                    {service.title}
                  </div>
                  <p className="mt-1.5 text-[13px] leading-[1.55] text-[#6f7282]">
                    {service.summary}
                  </p>
                  <p className="mt-3 text-[13px] leading-[1.6] text-[#3c4053]">
                    {service.description}
                  </p>

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="text-[17px] font-semibold tabular-nums tracking-[-0.01em] text-[#0b1024]">
                      {formatServicePrice(service)}
                    </div>
                    {canOrder ? (
                      <button
                        type="button"
                        onClick={() => openService(service)}
                        className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0]"
                      >
                        {instant && balanceRub >= (service.priceRub ?? 0) ? (
                          <Sparkles className="size-4" />
                        ) : null}
                        Заказать
                      </button>
                    ) : (
                      <span className="text-[12.5px] text-[#9b9fb3]">
                        Заказывает руководитель
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <ConfirmDialog
        open={active !== null}
        onClose={() => setActive(null)}
        onConfirm={submit}
        variant="info"
        title={active ? `Заказать: ${active.title}` : "Заказать услугу"}
        description={
          active ? (
            <span className="text-[13px] text-[#3c4053]">
              {formatServicePrice(active)}
            </span>
          ) : undefined
        }
        bullets={
          enoughBalance
            ? [
                {
                  label: `Спишем ${price.toLocaleString("ru-RU")} ₽ с баланса, останется ${(balanceRub - price).toLocaleString("ru-RU")} ₽`,
                  tone: "info",
                },
                { label: "Свяжемся с вами в течение рабочего дня" },
              ]
            : payable
              ? [
                  {
                    label: `На балансе ${balanceRub.toLocaleString("ru-RU")} ₽ — этого не хватает, оплату обсудим отдельно`,
                    tone: "warn",
                  },
                  { label: "Заявку всё равно примем и свяжемся с вами" },
                ]
              : [
                  {
                    label: "Стоимость зависит от объёма — посчитаем после разговора",
                    tone: "info",
                  },
                  { label: "Баллы за эту услугу сейчас не списываются" },
                  { label: "Свяжемся с вами в течение рабочего дня" },
                ]
        }
        confirmLabel={
          sending
            ? "Отправляем…"
            : enoughBalance
              ? insideApp
                ? "Заказать"
                : "Оплатить и заказать"
              : "Отправить заявку"
        }
        confirmDisabled={sending}
      >
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
              Как к вам обращаться
            </span>
            <input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              className={FIELD_CLASS}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
              Телефон для связи
            </span>
            <input
              value={form.phone}
              onChange={(event) =>
                setForm((current) => ({ ...current, phone: event.target.value }))
              }
              placeholder="+7 999 123-45-67"
              className={FIELD_CLASS}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
              Что важно знать заранее
            </span>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
              placeholder="Например: открываемся через месяц, проверка в октябре"
              className="w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 py-2.5 text-[14px] leading-[1.5] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </label>
          {enoughBalance ? (
            <div className="flex items-start gap-2 rounded-2xl bg-[#ecfdf5] p-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#116b2a]" />
              <span className="text-[12.5px] leading-[1.5] text-[#116b2a]">
                Оплата пройдёт баллами сразу после подтверждения. Возврат — по
                договорённости, если мы ещё не начали работу.
              </span>
            </div>
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
