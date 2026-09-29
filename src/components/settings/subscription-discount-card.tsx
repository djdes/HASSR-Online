"use client";

import { ArrowRight, Loader2, Ticket } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { PersonalDiscountBadge, PromoPrice } from "@/components/pricing/promo-price";
import type { AppliedDiscount, LifetimeDiscountView } from "@/lib/promo/discounts";
import type { PriceWithPromotion } from "@/lib/promo/promotions";

/**
 * «Промокод и скидка» на странице тарифа.
 *
 * Считает всё сервер (`resolveCheckoutDiscount` на странице): здесь только
 * поле ввода и показ. «Применить» перезагружает страницу с `?promo=CODE` —
 * сервер заново посчитает цену в карточке тарифа, счёте и этой карточке.
 * Скидка навсегда аккаунта применяется сама — её видно и без кода.
 */
export function SubscriptionDiscountCard({
  offer,
  periodDays,
  lifetime,
  applied,
  typedCode,
  error,
  notice,
  personalPending = false,
  payHref,
}: {
  /** Цена подписки с акцией (сервер). */
  offer: Pick<PriceWithPromotion, "baseRub" | "priceRub" | "promotion">;
  periodDays: number;
  /** Действующая скидка навсегда аккаунта. */
  lifetime: LifetimeDiscountView | null;
  /** Что применится к оплате (код или скидка навсегда). */
  applied: AppliedDiscount | null;
  /** Код в поле: из ссылки, cookie или введённый. */
  typedCode: string | null;
  /** Код не подошёл — причина. */
  error: string | null;
  /** Что применено и почему (выгоднейшая из двух). */
  notice: string | null;
  personalPending?: boolean;
  /** «Оплатить картой» — /order с кодом. */
  payHref: string;
}) {
  const router = useRouter();
  const [input, setInput] = useState(typedCode ?? "");
  const [pending, startTransition] = useTransition();

  function apply() {
    const code = input.trim().toUpperCase().replace(/\s+/g, "");
    if (!code) return;
    startTransition(() => {
      router.replace(`/settings/subscription?promo=${encodeURIComponent(code)}`, { scroll: false });
    });
  }

  const boundAt = lifetime ? new Date(lifetime.boundAt).toLocaleDateString("ru-RU") : null;

  return (
    <section
      data-testid="subscription-discount"
      className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7"
    >
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <Ticket className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">Промокод и скидка</h2>

          {lifetime ? (
            <div data-testid="lifetime-discount" className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-[#3c4053]">
              <PersonalDiscountBadge
                discount={{ source: "lifetime", code: lifetime.code, kind: lifetime.kind, value: lifetime.value, lifetime: true }}
              />
              <span className="leading-relaxed">
                Применяется сама к каждой оплате подписки — картой и по счёту. Вводить ничего не нужно
                {boundAt ? ` (действует с ${boundAt})` : ""}.
              </span>
            </div>
          ) : (
            <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-[#6f7282]">
              Есть персональный промокод? Введите его — цена ниже пересчитается, скидка попадёт в оплату
              картой и в счёт.
            </p>
          )}

          <div className="mt-4 flex max-w-[480px] gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  apply();
                }
              }}
              placeholder="Например, ROMASHKA10"
              aria-label="Промокод"
              className="h-11 min-w-0 flex-1 rounded-2xl border border-[#dcdfed] bg-white px-4 font-mono text-[14px] text-[#0b1024] placeholder:font-sans placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <button
              type="button"
              onClick={apply}
              disabled={pending || !input.trim()}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {pending ? "Проверяем…" : "Применить"}
            </button>
          </div>

          {error ? (
            <p data-testid="promo-error" className="mt-2 text-[13px] text-[#a13a32]">
              {error}
            </p>
          ) : null}
          {!error && applied?.source === "code" ? (
            <p data-testid="promo-applied" className="mt-2 text-[13px] text-[#116b2a]">
              Промокод {applied.code} применён: −{applied.discountRub.toLocaleString("ru-RU")} ₽ от подписки
              {offer.promotion ? " (считается от цены по акции)" : ""}.
            </p>
          ) : null}
          {notice ? (
            <p data-testid="promo-notice" className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-[#3848c7]">
              {notice}
            </p>
          ) : null}
          {personalPending ? (
            <p className="mt-2 text-[13px] text-[#6f7282]">Персональный промокод — проверим по почте при оплате.</p>
          ) : null}

          {applied ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
              <div className="min-w-0 text-[13px] text-[#3c4053]">
                <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#6f7282]">
                  К оплате за {periodDays} дн.
                </div>
                <PromoPrice price={offer} personal={applied} size="md" className="mt-1" />
              </div>
              <Link
                href={payHref}
                data-testid="discount-pay"
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
              >
                Оплатить картой
                <ArrowRight className="size-4" />
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
