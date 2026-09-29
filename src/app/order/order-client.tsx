"use client";
import { RU_PHONE_PLACEHOLDER, phoneInputProps } from "@/lib/phone-input";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Coins,
  Loader2,
  ShieldCheck,
  XCircle,
  Ticket,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  HARDWARE_DEVICES,
  type HardwareDevice,
} from "@/lib/hardware-pricing";
import { ROBOKASSA_IFRAME_SCRIPT_URL } from "@/lib/robokassa-constants";
import type { Tariff } from "@/lib/tariffs";
import type { SubscriptionOffer } from "@/lib/promo/promotions";
import type { AppliedDiscount } from "@/lib/promo/discounts";
import { PromoPrice } from "@/components/pricing/promo-price";
import {
  RECURRING_CONSENT_TEXT,
  RECURRING_OFFER_HREF,
  RECURRING_PERIOD_TEXT,
} from "@/lib/recurring-consent";
import { JOURNALS_TOTAL } from "@/lib/journal-catalog";

type ReturnParams = {
  outSum: string;
  invId: string;
  signature: string;
  completeToken: string;
};

type OrderStatus = {
  invId: number;
  status: string;
  email: string;
  amountRub: number;
  /** Сколько рублей закрыли баллами. */
  pointsSpent?: number;
  description: string;
  isTest: boolean;
  needsCompletion: boolean;
};

/** Оплачен ли заказ. `expired` — истёкший холд баллов, это не оплата. */
function isPaidStatus(status: string): boolean {
  return status === "paid" || status === "completed";
}

/** Скидка поверх акции, как её посчитал сервер, с подписью плашки. */
export type OrderDiscountView = AppliedDiscount & { label: string };

/**
 * Скидка при открытии страницы (сервер, `resolveCheckoutDiscount`): код из
 * `?promo=`/cookie ссылки и скидка навсегда вошедшего аккаунта.
 */
export type OrderDiscountState = {
  /** Что применится к оплате: промокод или скидка навсегда. */
  applied: OrderDiscountView | null;
  /** Принятый введённый код — уходит в заказ (сервер пересчитает). */
  typedCode: string | null;
  /** Что подставить в поле промокода. */
  input: string;
  error: string | null;
  /** Что применено и почему (выгоднейшая из двух). */
  notice: string | null;
  /** Персональный код без входа — проверим по почте при оплате. */
  personalPending: boolean;
};

declare global {
  interface Window {
    Robokassa?: { StartPayment: (params: Record<string, string>) => void };
  }
}

function formatRub(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value) + " ₽";
}

/**
 * Одна страница на три состояния, потому что кабинет Робокассы принимает
 * ровно один SuccessURL/FailURL:
 *
 *   1. checkout — пришли с лендинга по /order?plan=…, спрашиваем почту
 *      и открываем оплату в iFrame;
 *   2. возврат после оплаты — Робокасса вернула OutSum/InvId/Signature,
 *      поллим статус (вебхук может прийти на секунду позже) и, если это
 *      новый клиент, показываем форму достройки профиля;
 *   3. переход по ссылке из письма — ?complete=<токен>, сразу форма.
 *
 * Отдельного «fail»-состояния в query нет: если валидной подписи нет,
 * а заказ не оплачен — показываем экран неудачи с возвратом к оплате.
 */
export function OrderClient({
  tariff,
  offer = null,
  bundleConfig,
  amountRub,
  returnParams,
  sessionEmail = "",
  recurringDefault = false,
  pointsAvailable = 0,
  pointsCap = 0,
  initialDiscount,
}: {
  tariff: Tariff | null;
  /// Цена подписки с действующей акцией (сервер). amountRub уже её учитывает.
  offer?: SubscriptionOffer | null;
  /// Промокод из ссылки и скидка навсегда — посчитаны сервером.
  initialDiscount?: OrderDiscountState;
  bundleConfig: Record<string, number> | null;
  amountRub: number;
  returnParams: ReturnParams;
  /// Почта вошедшего пользователя — подставляем, чтобы не спрашивать её
  /// второй раз сразу после регистрации.
  sessionEmail?: string;
  /// Пришли по кнопке «Включить автопродление» — галочка уже отмечена.
  /// Это не нарушает требование Робокассы «не проставлено по умолчанию»:
  /// человек сам нажал кнопку с этим смыслом, а снять отметку он может.
  recurringDefault?: boolean;
  /// Баллы организации. Ноль — блок списания не показываем вовсе.
  pointsAvailable?: number;
  /// Потолок списания — цена подписки без оборудования.
  pointsCap?: number;
}) {
  const isReturn = Boolean(
    (returnParams.invId && returnParams.signature) || returnParams.completeToken,
  );
  return isReturn ? (
    <ReturnFlow params={returnParams} />
  ) : (
    <Checkout
      tariff={tariff}
      offer={offer}
      bundleConfig={bundleConfig}
      amountRub={amountRub}
      sessionEmail={sessionEmail}
      recurringDefault={recurringDefault}
      pointsAvailable={pointsAvailable}
      pointsCap={pointsCap}
      initialDiscount={initialDiscount}
    />
  );
}

/* ---------------------------------------------------------------- checkout */

function Checkout({
  tariff,
  offer = null,
  bundleConfig,
  amountRub,
  sessionEmail,
  recurringDefault = false,
  pointsAvailable = 0,
  pointsCap = 0,
  initialDiscount,
}: {
  tariff: Tariff | null;
  offer?: SubscriptionOffer | null;
  bundleConfig: Record<string, number> | null;
  amountRub: number;
  sessionEmail: string;
  recurringDefault?: boolean;
  pointsAvailable?: number;
  pointsCap?: number;
  initialDiscount?: OrderDiscountState;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(sessionEmail);
  // По умолчанию выключено — этого требует Робокасса: согласие на
  // автосписание человек даёт сам, а не получает вместе с формой.
  const [recurringConsent, setRecurringConsent] = useState(recurringDefault);
  // Баллы, наоборот, списываем по умолчанию: они уже принадлежат
  // организации, и «забыл включить» — это переплата на ровном месте.
  const [usePoints, setUsePoints] = useState(true);
  // Промокод и скидка навсегда: считает сервер (страница, /api/promo/check,
  // создание заказа), здесь только показываем честный итог до нажатия;
  // сумму скидки браузер не решает. Применяется выгоднейшая из двух.
  const [promoInput, setPromoInput] = useState(initialDiscount?.input ?? "");
  const [discount, setDiscount] = useState<OrderDiscountView | null>(initialDiscount?.applied ?? null);
  const [typedCode, setTypedCode] = useState<string | null>(initialDiscount?.typedCode ?? null);
  const [promoNotice, setPromoNotice] = useState<string | null>(initialDiscount?.notice ?? null);
  const [personalPending, setPersonalPending] = useState(initialDiscount?.personalPending ?? false);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(initialDiscount?.error ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Заказ, оформленный раньше, протух вместе с холдом баллов — их уже
  // вернули на баланс, оформлять надо заново.
  const [expired, setExpired] = useState(false);
  const scriptReady = useRobokassaScript();
  // Пока клиент платит в iFrame, следим за заказом здесь: возврат на
  // SuccessURL происходит внутри рамки, и внешняя страница иначе так и
  // осталась бы формой оплаты, хотя деньги уже прошли.
  const [watch, setWatch] = useState<{ invId: number; psig: string } | null>(
    null,
  );
  const [paid, setPaid] = useState<OrderStatus | null>(null);

  useEffect(() => {
    if (!watch || paid) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const res = await fetch(
          `/api/payments/robokassa/status?invId=${watch.invId}&psig=${encodeURIComponent(watch.psig)}`,
        );
        if (res.ok) {
          const data = (await res.json()) as OrderStatus;
          if (isPaidStatus(data.status)) {
            if (!stopped) setPaid(data);
            return;
          }
          if (data.status !== "pending") {
            // «expired» — холд баллов истёк и заказ закрыт. Это не оплата,
            // и показывать «Оплата получена» здесь было бы обманом.
            if (!stopped) {
              setExpired(true);
              setWatch(null);
            }
            return;
          }
        }
      } catch {
        /* сеть моргнула — просто пробуем ещё раз */
      }
      if (!stopped) timer = setTimeout(tick, 3000);
    };
    timer = setTimeout(tick, 3000);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [watch, paid]);

  if (expired && !paid) {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <XCircle className="size-7 text-[#a13a32]" />
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">
            Заказ истёк
          </h1>
        </div>
        <p className="mt-3 text-[15px] leading-[1.7] text-[#3c4053]">
          Оплату мы так и не получили, поэтому заказ закрыт, а списанные
          баллы вернулись на баланс организации. Оформите оплату заново —
          баллы спишутся снова.
        </p>
        <div className="mt-6">
          <button
            type="button"
            onClick={() => {
              setExpired(false);
              setError(null);
            }}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
          >
            Оформить заново
            <ArrowRight className="size-4" />
          </button>
        </div>
      </Card>
    );
  }

  if (paid) {
    return (
      <Card>
        <Paid order={paid} />
        {paid.needsCompletion ? (
          <>
            <p className="mt-4 text-[15px] leading-[1.7] text-[#3c4053]">
              Мы отправили на <strong>{paid.email}</strong> письмо со ссылкой
              для завершения настройки: там нужно задать пароль и название
              организации.
            </p>
            <p className="mt-2 text-[13px] text-[#9b9fb3]">
              Письма нет через 10 минут? Напишите на support@wesetup.ru —
              вышлем ссылку вручную.
            </p>
          </>
        ) : (
          <>
            <p className="mt-4 text-[15px] leading-[1.7] text-[#3c4053]">
              Подписка вашей организации продлена. Входите под своей обычной
              учётной записью.
            </p>
            <div className="mt-6">
              <PrimaryLink href="/login">Войти в кабинет</PrimaryLink>
            </div>
          </>
        )}
      </Card>
    );
  }

  if (!tariff) {
    return (
      <Card>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">
          Тариф недоступен
        </h1>
        <p className="mt-3 text-[15px] leading-[1.7] text-[#3c4053]">
          Похоже, ссылка устарела. Выберите тариф заново на странице цен.
        </p>
        <div className="mt-6">
          <PrimaryLink href="/pricing">Перейти к тарифам</PrimaryLink>
        </div>
      </Card>
    );
  }

  const items: Array<{ device: HardwareDevice; qty: number }> = bundleConfig
    ? HARDWARE_DEVICES.filter((d) => (bundleConfig[d.id] ?? 0) > 0).map((d) => ({
        device: d,
        qty: bundleConfig[d.id] ?? 0,
      }))
    : [];

  // Сколько спишется баллами. Та же формула, что на сервере
  // (`pointsToSpend`): не больше баланса и не больше цены подписки.
  // Здесь она нужна только чтобы показать честный итог до нажатия.
  const discountRub = discount?.discountRub ?? 0;
  const amountAfterPromo = Math.max(0, amountRub - discountRub);
  const capAfterPromo = Math.max(0, pointsCap - discountRub);
  const pointsSpent =
    usePoints && !recurringConsent
      ? Math.min(pointsAvailable, Math.min(capAfterPromo, amountAfterPromo))
      : 0;
  const netRub = Math.max(0, amountAfterPromo - pointsSpent);
  const showPointsBlock = pointsAvailable > 0;
  // Цена подписки с акцией для строки «Подписка»: без акции — цена тарифа.
  const subscriptionPrice = offer ?? {
    baseRub: tariff.priceRub,
    priceRub: tariff.priceRub,
    discountRub: 0,
    promotion: null,
  };
  async function applyPromo() {
    const code = promoInput.trim();
    if (!code || !tariff) return;
    setPromoBusy(true);
    setPromoError(null);
    try {
      const res = await fetch("/api/promo/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, tariffKey: tariff.key }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        offerRub?: number;
        applied?: OrderDiscountView | null;
        fallback?: OrderDiscountView | null;
        typedCode?: string | null;
        notice?: string | null;
        personalPending?: boolean;
      };
      // Акция началась или кончилась, пока страница была открыта: скидка
      // промокода посчитана от другой цены — обновляем страницу, сумма
      // пересчитается, промокод нужно применить ещё раз.
      if (typeof data.offerRub === "number" && data.offerRub !== subscriptionPrice.priceRub) {
        setDiscount(null);
        setTypedCode(null);
        setPromoNotice(null);
        setPromoError("Цена подписки изменилась — обновили сумму. Нажмите «Применить» ещё раз");
        router.refresh();
        return;
      }
      if (!res.ok || !data.ok) {
        // Код не подошёл — остаётся то, что положено без него (скидка навсегда).
        setDiscount(data.fallback ?? null);
        setTypedCode(null);
        setPromoNotice(null);
        setPersonalPending(false);
        setPromoError(data.message ?? "Промокод не подошёл");
        return;
      }
      setDiscount(data.applied ?? null);
      setTypedCode(data.typedCode ?? null);
      setPromoNotice(data.notice ?? null);
      setPersonalPending(Boolean(data.personalPending));
    } catch {
      setPromoError("Нет связи — попробуйте ещё раз");
    } finally {
      setPromoBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/payments/robokassa/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          tariffKey: tariff!.key,
          bundleConfig: bundleConfig ?? undefined,
          recurringConsent,
          usePoints: pointsSpent > 0,
          promoCode: typedCode ?? undefined,
          // Сверка, не сумма: сервер считает сам и откажет, если за время
          // на странице цена изменилась (закончилась или началась акция).
          expectedGrossRub: amountAfterPromo,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Не удалось создать заказ");
        setLoading(false);
        if (data.code === "price-changed") {
          // Сервер прислал скидку, посчитанную по текущей цене (в том числе
          // скидку навсегда почты заказа, о которой страница без входа не
          // знала): показываем её — следующая попытка сойдётся по сумме.
          if ("discount" in data) {
            setDiscount((data.discount as OrderDiscountView | null) ?? null);
            setPromoNotice(typeof data.notice === "string" ? data.notice : null);
          }
          router.refresh();
        }
        return;
      }
      // Заказ полностью закрыт баллами — кассы в этой дороге нет,
      // сервер уже провёл оплату и вернул готовый статус заказа.
      if (data.paidByPoints) {
        setPaid(data as OrderStatus);
        setLoading(false);
        return;
      }
      // iFrame — основной путь; если скрипт не поднялся (блокировщик,
      // офлайн CDN), уводим на обычную форму оплаты, чтобы клиент не
      // упёрся в неработающую кнопку.
      if (scriptReady && window.Robokassa) {
        window.Robokassa.StartPayment(data.params);
        setWatch({ invId: data.invId, psig: data.params.SignatureValue });
        setLoading(false);
        return;
      }
      window.location.href = data.paymentUrl;
    } catch {
      setError("Сеть недоступна. Попробуйте ещё раз");
      setLoading(false);
    }
  }

  return (
    <Card>
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] sm:text-[32px]">
        Оформление подписки
      </h1>
      <p className="mt-3 text-[15px] leading-[1.7] text-[#3c4053]">
        {tariff.title} — доступ ко всем журналам СанПиН и ХАССП ({JOURNALS_TOTAL}) на{" "}
        {tariff.periodDays} дней.
      </p>

      <div className="mt-6 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] uppercase tracking-[0.14em] text-[#9b9fb3]">
            К оплате
          </span>
          <span className="text-[26px] font-semibold tabular-nums tracking-[-0.01em]">
            {formatRub(netRub)}
          </span>
        </div>
        {items.length > 0 || pointsSpent > 0 || discountRub > 0 || subscriptionPrice.promotion ? (
          <ul className="mt-4 space-y-1.5 border-t border-[#ececf4] pt-4">
            {/* Акция и персональная скидка (промокод или скидка навсегда)
                — прямо в строке подписки: старая цена зачёркнута, новая и
                плашки «−N % до …», «Ваша скидка −10 % навсегда». Скидка
                считается от цены с акцией; баллы — ниже. */}
            <li
              data-testid="order-subscription-line"
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[13px] text-[#3c4053]"
            >
              <span>Подписка на {tariff.periodDays} дн.</span>
              <PromoPrice
                price={subscriptionPrice}
                personal={discount}
                size="text"
                tone="inherit"
                className="justify-end"
              />
            </li>
            {items.map(({ device, qty }) => (
              <li
                key={device.id}
                className="flex justify-between gap-3 text-[13px] text-[#3c4053]"
              >
                <span>
                  {device.title}
                  {device.mode === "per-unit" ? ` × ${qty}` : ""}
                </span>
                <span className="tabular-nums">
                  {formatRub(device.price * qty)}
                </span>
              </li>
            ))}
            {pointsSpent > 0 ? (
              <li className="flex justify-between gap-3 text-[13px] font-medium text-[#116b2a]">
                <span>Баллами</span>
                <span className="tabular-nums">−{formatRub(pointsSpent)}</span>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      {/* Промокод — отдельным блоком под итогом: клиент видит, как
          меняется сумма, до нажатия «Оплатить». */}
      <div className="mt-4 rounded-2xl border border-[#dcdfed] bg-white p-5">
        <div className="flex items-center gap-2 text-[15px] font-medium text-[#0b1024]">
          <Ticket className="size-4 text-[#5566f6]" />
          Промокод
        </div>
        <div className="mt-3 flex gap-2">
          <input
            value={promoInput}
            onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void applyPromo();
              }
            }}
            placeholder="Например, WELCOME10"
            aria-label="Промокод"
            className="h-11 min-w-0 flex-1 rounded-2xl border border-[#dcdfed] bg-white px-4 font-mono text-[14px] text-[#0b1024] placeholder:font-sans placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
          <button
            type="button"
            onClick={() => void applyPromo()}
            disabled={promoBusy || !promoInput.trim()}
            className="inline-flex h-11 shrink-0 items-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50"
          >
            {promoBusy ? "Проверяем…" : typedCode ? "Обновить" : "Применить"}
          </button>
        </div>
        {promoError ? (
          <p data-testid="promo-error" className="mt-2 text-[12px] text-[#a13a32]">
            {promoError}
          </p>
        ) : discount?.source === "code" ? (
          <p data-testid="promo-applied" className="mt-2 text-[12px] text-[#116b2a]">
            Промокод {discount.code} применён: −{formatRub(discount.discountRub)} от подписки
            {subscriptionPrice.promotion ? " (считается от цены по акции)" : ""}.
          </p>
        ) : discount?.source === "lifetime" && !typedCode ? (
          <p data-testid="lifetime-applied" className="mt-2 text-[12px] text-[#116b2a]">
            {discount.label}: −{formatRub(discount.discountRub)} от подписки — применяется сама,
            вводить ничего не нужно.
          </p>
        ) : null}
        {promoNotice ? (
          <p data-testid="promo-notice" className="mt-2 text-[12px] leading-[1.5] text-[#3848c7]">
            {promoNotice}
          </p>
        ) : null}
        {personalPending ? (
          <p className="mt-2 text-[12px] text-[#6f7282]">
            Персональный промокод — проверим по почте при оплате.
          </p>
        ) : null}
      </div>
      {showPointsBlock ? (
        <div className="mt-4 rounded-2xl border border-[#dcdfed] bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[15px] font-medium text-[#0b1024]">
                <Coins className="size-4 text-[#5566f6]" />
                Списать баллы
              </div>
              <p className="mt-1 text-[13px] leading-[1.5] text-[#6f7282]">
                На балансе организации {formatRub(pointsAvailable)}. 1 балл =
                1 ₽, баллами оплачивается подписка — оборудование нет.
              </p>
            </div>
            <Switch
              checked={usePoints && !recurringConsent}
              disabled={recurringConsent}
              onCheckedChange={(next) => setUsePoints(next)}
              aria-label="Списать баллы"
            />
          </div>
          {recurringConsent ? (
            <p className="mt-3 rounded-xl bg-[#fff8eb] px-3 py-2 text-[12px] leading-[1.5] text-[#a16d32]">
              При автопродлении баллы не списываются: касса запомнит карту с
              уменьшенной суммой, и следующие списания пошли бы не по цене
              тарифа. Снимите галочку автосписаний, чтобы использовать баллы.
            </p>
          ) : pointsSpent > 0 ? (
            <p className="mt-3 text-[12px] text-[#6f7282]">
              Спишется {formatRub(pointsSpent)}, останется{" "}
              {formatRub(pointsAvailable - pointsSpent)}.
            </p>
          ) : (
            <p className="mt-3 text-[12px] text-[#6f7282]">
              Тумблер выключен — платите полную сумму, баллы остаются на
              балансе.
            </p>
          )}
        </div>
      ) : null}

      <form onSubmit={submit} className="mt-6">
        <label
          htmlFor="order-email"
          className="block text-[13px] font-medium text-[#0b1024]"
        >
          Электронная почта
        </label>
        <p className="mt-1 text-[12px] text-[#9b9fb3]">
          На неё придёт чек и ссылка для входа в кабинет.
        </p>
        {/* У вошедшего адрес не редактируется: сервер всё равно возьмёт
            почту из сессии, иначе баллы организации ушли бы на заказ с
            чужим адресом. Показываем то же, что уйдёт в чек. */}
        <input
          id="order-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          readOnly={Boolean(sessionEmail)}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.ru"
          className={`mt-2 h-12 w-full rounded-2xl border border-[#dcdfed] px-4 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 ${
            sessionEmail ? "bg-[#fafbff]" : "bg-white"
          }`}
        />

        {error ? (
          <p className="mt-3 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]">
            {error}
          </p>
        ) : null}

        {/* Автосписания. Галочка НЕ проставлена по умолчанию: без неё
            платёж разовый, и это нормальный путь. Текст согласия и
            периодичность списаний видны здесь же — скрытых платежей быть
            не должно. */}
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-4 py-3">
          <input
            type="checkbox"
            checked={recurringConsent}
            onChange={(event) => {
              setRecurringConsent(event.target.checked);
              // Автосписания и баллы взаимоисключающи — включаем одно,
              // гасим другое, чтобы итог в карточке не врал.
              if (event.target.checked) setUsePoints(false);
              else setUsePoints(true);
            }}
            className="mt-0.5 size-4 shrink-0 accent-[#5566f6]"
          />
          <span className="text-[13px] leading-[1.5] text-[#3c4053]">
            {RECURRING_CONSENT_TEXT} (
            <Link
              href={RECURRING_OFFER_HREF}
              target="_blank"
              className="text-[#3848c7] underline"
            >
              раздел 13 оферты
            </Link>
            ).
            <span className="mt-1 block text-[12px] text-[#6f7282]">
              {RECURRING_PERIOD_TEXT}
            </span>
            <span className="mt-1 block text-[12px] text-[#9b9fb3]">
              Без галочки оплата пройдёт разовым платежом — автосписаний не
              будет.
            </span>
          </span>
        </label>

        <button
          type="submit"
          disabled={loading}
          className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {netRub === 0 ? "Проводим оплату…" : "Открываем оплату…"}
            </>
          ) : netRub === 0 ? (
            <>
              <Coins className="size-4" />
              {/* Ноль бывает и без баллов — промокод на 100 %. */}
              {pointsSpent > 0 ? "Оплатить баллами" : "Оформить без оплаты"}
            </>
          ) : (
            <>
              Перейти к оплате
              <ArrowRight className="size-4" />
            </>
          )}
        </button>

        {watch ? (
          <p className="mt-3 flex items-center justify-center gap-2 text-[13px] text-[#6f7282]">
            <Loader2 className="size-3.5 animate-spin text-[#5566f6]" />
            Ждём подтверждение оплаты — страница обновится сама.
          </p>
        ) : null}
      </form>

      <p className="mt-4 flex items-start gap-2 text-[12px] leading-[1.6] text-[#9b9fb3]">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
        <span>
          Оплата проходит на стороне сервиса «Робокасса», данные карты нам не
          передаются. Нажимая «Перейти к оплате», вы принимаете условия{" "}
          <Link href="/oferta" className="text-[#3848c7]">
            договора-оферты
          </Link>{" "}
          и{" "}
          <Link href="/privacy" className="text-[#3848c7]">
            политики конфиденциальности
          </Link>
          , а также{" "}
          <Link href="/terms" className="text-[#3848c7]">
            пользовательского соглашения
          </Link>{" "}
          и{" "}
          <Link href="/consent" className="text-[#3848c7]">
            согласия на обработку персональных данных
          </Link>
          .
        </span>
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ return */

function ReturnFlow({ params }: { params: ReturnParams }) {
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const attempts = useRef(0);

  const query = params.completeToken
    ? `complete=${encodeURIComponent(params.completeToken)}`
    : `OutSum=${encodeURIComponent(params.outSum)}&InvId=${encodeURIComponent(
        params.invId,
      )}&SignatureValue=${encodeURIComponent(params.signature)}`;

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/payments/robokassa/status?${query}`);
      if (!res.ok) {
        setFailed(true);
        return true;
      }
      const data = (await res.json()) as OrderStatus;
      setOrder(data);
      // Вебхук может опоздать на пару секунд — ждём перехода в paid,
      // но не бесконечно: после ~20 попыток показываем «проверьте позже».
      if (data.status === "pending") {
        attempts.current += 1;
        if (attempts.current > 20) {
          setFailed(true);
          return true;
        }
        return false;
      }
      return true;
    } catch {
      attempts.current += 1;
      if (attempts.current > 20) {
        setFailed(true);
        return true;
      }
      return false;
    }
  }, [query]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const done = await poll();
      if (stopped || done) return;
      timer = setTimeout(tick, 2000);
    };
    void tick();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [poll]);

  if (failed) {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <XCircle className="size-7 text-[#a13a32]" />
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">
            Оплата не прошла
          </h1>
        </div>
        <p className="mt-3 text-[15px] leading-[1.7] text-[#3c4053]">
          Платёж не подтверждён. Деньги, если они списались, вернутся
          автоматически в течение нескольких дней.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <PrimaryLink href="/pricing">Попробовать ещё раз</PrimaryLink>
          <a
            href="mailto:support@wesetup.ru"
            className="inline-flex h-12 items-center rounded-2xl border border-[#dcdfed] bg-white px-5 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            Написать в поддержку
          </a>
        </div>
      </Card>
    );
  }

  if (!order || order.status === "pending") {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <Loader2 className="size-6 animate-spin text-[#5566f6]" />
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">
            Проверяем оплату…
          </h1>
        </div>
        <p className="mt-3 text-[15px] leading-[1.7] text-[#3c4053]">
          Это занимает несколько секунд. Не закрывайте страницу.
        </p>
      </Card>
    );
  }

  // Заказ закрыт по истечении холда баллов. Раньше любой не-pending
  // статус считался успехом, и человек видел «Оплата получена» на
  // неоплаченном заказе.
  if (!isPaidStatus(order.status)) {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <XCircle className="size-7 text-[#a13a32]" />
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">
            Заказ истёк
          </h1>
        </div>
        <p className="mt-3 text-[15px] leading-[1.7] text-[#3c4053]">
          Оплату по заказу №{order.invId} мы не получили, поэтому он закрыт,
          а списанные баллы вернулись на баланс организации. Оформите оплату
          заново.
        </p>
        <div className="mt-6">
          <PrimaryLink href="/pricing">Выбрать тариф</PrimaryLink>
        </div>
      </Card>
    );
  }

  if (order.needsCompletion && params.completeToken) {
    return <CompleteForm token={params.completeToken} order={order} />;
  }

  if (order.needsCompletion) {
    // Токен есть в заказе, но в адресе его нет (обычный success-возврат).
    // Ссылка ушла письмом — просим открыть её.
    return (
      <Card>
        <Paid order={order} />
        <p className="mt-4 text-[15px] leading-[1.7] text-[#3c4053]">
          Мы отправили на <strong>{order.email}</strong> письмо со ссылкой для
          завершения настройки: там нужно задать пароль и название организации.
        </p>
        <p className="mt-2 text-[13px] text-[#9b9fb3]">
          Письма нет через 10 минут? Напишите на support@wesetup.ru — вышлем
          ссылку вручную.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <Paid order={order} />
      <p className="mt-4 text-[15px] leading-[1.7] text-[#3c4053]">
        Подписка вашей организации продлена. Входите под своей обычной учётной
        записью.
      </p>
      <div className="mt-6">
        <PrimaryLink href="/login">Войти в кабинет</PrimaryLink>
      </div>
    </Card>
  );
}

function Paid({ order }: { order: OrderStatus }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <CheckCircle2 className="size-7 text-[#116b2a]" />
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">
          Оплата получена
        </h1>
      </div>
      <div className="mt-4 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-5 text-[14px] text-[#3c4053]">
        <div className="flex justify-between gap-3">
          <span>{order.description}</span>
          <span className="tabular-nums font-semibold text-[#0b1024]">
            {order.amountRub === 0 && (order.pointsSpent ?? 0) > 0
              ? "оплачено баллами"
              : formatRub(order.amountRub)}
          </span>
        </div>
        {(order.pointsSpent ?? 0) > 0 && order.amountRub > 0 ? (
          <div className="mt-1 flex justify-between gap-3 text-[13px] text-[#116b2a]">
            <span>Списано баллами</span>
            <span className="tabular-nums">
              −{formatRub(order.pointsSpent ?? 0)}
            </span>
          </div>
        ) : null}
        <div className="mt-2 text-[12px] text-[#9b9fb3]">
          Заказ №{order.invId}
          {order.isTest ? " · тестовый платёж" : ""}
        </div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- complete */

function CompleteForm({
  token,
  order,
}: {
  token: string;
  order: OrderStatus;
}) {
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== password2) {
      setError("Пароли не совпадают");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/payments/robokassa/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, organizationName, name, phone, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Не удалось сохранить данные");
        setLoading(false);
        return;
      }
      // Автологин тем же паролем — клиент не должен вводить его дважды.
      const login = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email, password }),
      });
      if (login.ok) {
        router.push("/dashboard");
        router.refresh();
        return;
      }
      router.push("/login");
    } catch {
      setError("Сеть недоступна. Попробуйте ещё раз");
      setLoading(false);
    }
  }

  return (
    <Card>
      <Paid order={order} />
      <h2 className="mt-7 text-[18px] font-semibold tracking-[-0.01em]">
        Завершите настройку
      </h2>
      <p className="mt-2 text-[14px] leading-[1.7] text-[#3c4053]">
        Кабинет для <strong>{order.email}</strong> уже создан. Осталось задать
        пароль и назвать организацию.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field
          id="org"
          label="Название организации"
          value={organizationName}
          onChange={setOrganizationName}
          placeholder="ООО «Ромашка»"
          required
        />
        <Field
          id="name"
          label="Ваше имя"
          value={name}
          onChange={setName}
          placeholder="Иван Иванов"
          required
          autoComplete="name"
        />
        <Field
          id="phone"
          label="Телефон"
          value={phone}
          onChange={setPhone}
          placeholder={RU_PHONE_PLACEHOLDER}
          hint="Нужен, чтобы связать аккаунт с задачами в TasksFlow."
          required
          type="tel"
          autoComplete="tel"
          phone
        />
        <Field
          id="password"
          label="Пароль"
          value={password}
          onChange={setPassword}
          placeholder="Не короче 6 символов"
          required
          type="password"
          autoComplete="new-password"
        />
        <Field
          id="password2"
          label="Пароль ещё раз"
          value={password2}
          onChange={setPassword2}
          required
          type="password"
          autoComplete="new-password"
        />

        {error ? (
          <p className="rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Сохраняем…
            </>
          ) : (
            <>
              Войти в кабинет
              <ArrowRight className="size-4" />
            </>
          )}
        </button>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------- вспом. */

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-8">
      {children}
    </div>
  );
}

function PrimaryLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
    >
      {children}
      <ArrowRight className="size-4" />
    </Link>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  required,
  type = "text",
  autoComplete,
  phone = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  type?: string;
  autoComplete?: string;
  /** Телефон: «+7 » при фокусе и формат «+7 999 123-45-67» по мере ввода. */
  phone?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-medium text-[#0b1024]">
        {label}
      </label>
      {hint ? <p className="mt-1 text-[12px] text-[#9b9fb3]">{hint}</p> : null}
      <input
        id={id}
        type={type}
        required={required}
        placeholder={placeholder}
        {...(phone
          ? phoneInputProps(value, onChange)
          : {
              value,
              autoComplete,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
            })}
        className="mt-2 h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
      />
    </div>
  );
}

/**
 * Скрипт iFrame-оплаты подгружаем лениво — он нужен только на checkout'е
 * и только по клику, а тянуть внешний файл на каждый рендер страницы
 * возврата незачем.
 */
function useRobokassaScript(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const markReady = () => {
      if (!cancelled) setReady(true);
    };

    // Скрипт мог остаться от предыдущей навигации — тогда просто
    // отмечаем готовность, но уже вне тела эффекта.
    if (window.Robokassa) {
      queueMicrotask(markReady);
      return () => {
        cancelled = true;
      };
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${ROBOKASSA_IFRAME_SCRIPT_URL}"]`,
    );
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", markReady);
    if (!existing) {
      script.src = ROBOKASSA_IFRAME_SCRIPT_URL;
      script.async = true;
      document.body.appendChild(script);
    }
    return () => {
      cancelled = true;
      script.removeEventListener("load", markReady);
    };
  }, []);

  return ready;
}
