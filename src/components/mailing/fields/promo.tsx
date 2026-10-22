"use client";

import { useState } from "react";
import { Info, Ticket } from "lucide-react";

import type { MailingKindFieldsProps } from "@/components/mailing/kind-fields";
import {
  PROMO_DESIGNS,
  PROMO_PERCENT_MAX,
  PROMO_PERCENT_MIN,
  coercePromoPayload,
  designDefaults,
  promoPrices,
  rubLabel,
  type PromoDesign,
  type PromoFormData,
  type PromoMailPayload,
} from "@/lib/mailing/kinds/promo-shared";
import { promotionEndLabel } from "@/lib/promo/promotions";
import { PROMO_VALID_DAYS_MAX, PROMO_VALID_DAYS_MIN, promoEndsAfterDays } from "@/lib/promo/valid-days";
import { cn } from "@/lib/utils";

/**
 * Поля вида «Акция»: дизайн письма (пять карточек с эскизом), скидка и
 * срок, тариф и цена, тексты, выгоды, промокод (персональный каждому /
 * общий из «Промокодов») и живой расчёт цены. Тексты письма можно
 * править: при смене дизайна подставляются тексты нового дизайна, только
 * если прежние остались «как по умолчанию».
 */

const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60";
const TEXTAREA =
  "w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 py-2.5 text-[15px] leading-[1.5] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60";
const LABEL = "mb-1.5 block text-[13px] font-medium text-[#3c4053]";
const HINT = "mt-1.5 text-[12.5px] leading-[1.5] text-[#6f7282]";

const TEXT_FIELDS = ["subject", "headline", "lead", "buttonText"] as const;

/** Число с правкой «как в поле»: пока печатают — строка, после — значение из данных. */
function NumberInput({
  value,
  onValue,
  disabled,
  testId,
  label,
  id,
  max = 7,
}: {
  value: number;
  onValue: (next: number) => void;
  disabled?: boolean;
  testId: string;
  label: string;
  id?: string;
  max?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      id={id}
      inputMode="numeric"
      aria-label={label}
      value={draft ?? (Number.isFinite(value) && value > 0 ? String(value) : "")}
      disabled={disabled}
      onChange={(e) => {
        const text = e.target.value.replace(/\D/g, "").slice(0, max);
        setDraft(text);
        onValue(text === "" ? 0 : Number(text));
      }}
      onBlur={() => setDraft(null)}
      className={cn(INPUT, "tabular-nums")}
      data-testid={testId}
    />
  );
}

/** Мини-эскиз письма цветами дизайна — по нему выбирают, не читая подпись. */
function DesignSketch({ design }: { design: PromoDesign }) {
  const bar = "rounded-full";
  switch (design) {
    case "aurora":
      return (
        <div className="flex h-full flex-col justify-between rounded-xl bg-[#0b1024] p-2" style={{ backgroundImage: "radial-gradient(circle at 15% 0%, rgba(85,102,246,.6), transparent 60%)" }}>
          <span className="text-[17px] font-extrabold leading-none tracking-tight text-[#7cf5c0]">−15 %</span>
          <span className={cn(bar, "h-2.5 w-14 bg-gradient-to-r from-[#5566f6] to-[#7a5cff]")} />
        </div>
      );
    case "coupon":
      return (
        <div className="flex h-full items-stretch gap-0 rounded-xl bg-[#f4f5fb] p-2">
          <div className="flex w-[42%] items-center justify-center rounded-l-lg bg-[#5566f6] text-[11px] font-extrabold text-white">−15 %</div>
          <div className="flex flex-1 items-center justify-center rounded-r-lg bg-white">
            <span className="h-3.5 w-9 rounded-md border border-dashed border-[#5566f6] bg-[#f5f6ff]" />
          </div>
        </div>
      );
    case "countdown":
      return (
        <div className="flex h-full flex-col justify-between rounded-xl bg-[#0b1024] p-2">
          <span className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider text-[#7cf5c0]">
            <span className="size-1.5 rounded-full bg-[#7cf5c0]" /> идёт
          </span>
          <div className="flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="h-5 flex-1 rounded-md bg-[#1a2250]" />
            ))}
          </div>
        </div>
      );
    case "compare":
      return (
        <div className="flex h-full items-stretch gap-1.5 rounded-xl bg-white p-2 ring-1 ring-inset ring-[#ececf4]">
          <div className="flex flex-1 flex-col justify-center gap-1 rounded-lg bg-[#fafbff] p-1.5 ring-1 ring-inset ring-[#ececf4]">
            <span className={cn(bar, "h-1 w-6 bg-[#dcdfed]")} />
            <span className={cn(bar, "h-1.5 w-8 bg-[#9b9fb3]")} />
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 rounded-lg p-1.5 ring-2 ring-inset ring-[#5566f6]">
            <span className={cn(bar, "h-1 w-6 bg-[#5566f6]")} />
            <span className={cn(bar, "h-2 w-9 bg-[#0b1024]")} />
          </div>
        </div>
      );
    case "letter":
      return (
        <div className="flex h-full flex-col justify-center gap-1.5 rounded-xl bg-white p-2.5 ring-1 ring-inset ring-[#ececf4]">
          <span className={cn(bar, "h-1.5 w-8 bg-[#0b1024]")} />
          <span className={cn(bar, "h-1 w-full bg-[#dcdfed]")} />
          <span className={cn(bar, "h-1 w-4/5 bg-[#c9f7e4]")} />
          <span className={cn(bar, "h-2.5 w-10 bg-[#5566f6]")} />
        </div>
      );
  }
}

export default function PromoFields({ payload, onChange, disabled, audience, formData }: MailingKindFieldsProps<PromoMailPayload>) {
  const value = coercePromoPayload(payload);
  const data = (formData ?? null) as PromoFormData | null;
  const promo = value.promo;
  const set = (patch: Partial<PromoMailPayload>) => onChange({ ...value, ...patch });
  const setPromo = (patch: Partial<PromoMailPayload["promo"]>) => onChange({ ...value, promo: { ...value.promo, ...patch } });
  const [benefitsDraft, setBenefitsDraft] = useState<string | null>(null);

  const pickDesign = (next: PromoDesign) => {
    if (next === value.design) return;
    const before = designDefaults(value.design);
    const after = designDefaults(next);
    const patch: Partial<PromoMailPayload> = { design: next };
    // Правки не затираем: подставляем тексты нового дизайна только вместо «как по умолчанию».
    for (const key of TEXT_FIELDS) if (value[key] === before[key]) patch[key] = after[key];
    set(patch);
  };

  const options = data?.promoOptions ?? [];
  const chosenCode = promo.code ? promo.code.toUpperCase() : null;
  const selected = chosenCode ? (options.find((o) => o.code === chosenCode) ?? null) : null;
  const recipients = audience.users + audience.contacts;
  const percentOk = Number.isInteger(value.discountPercent) && value.discountPercent >= PROMO_PERCENT_MIN && value.discountPercent <= PROMO_PERCENT_MAX;
  const daysOk = Number.isInteger(value.durationDays) && value.durationDays >= PROMO_VALID_DAYS_MIN && value.durationDays <= PROMO_VALID_DAYS_MAX;
  const priceOk = Number.isInteger(value.priceRub) && value.priceRub >= 100 && value.priceRub <= 1_000_000;
  const endsLabel = daysOk ? promotionEndLabel(promoEndsAfterDays(new Date(), value.durationDays)) : null;
  const prices = priceOk && percentOk ? promoPrices(value.priceRub, value.discountPercent) : null;
  const paid = data?.paidTariff ?? null;

  return (
    <div className="space-y-5" data-testid="mailing-fields-promo">
      <fieldset>
        <legend className={LABEL}>Дизайн письма</legend>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5" role="radiogroup">
          {PROMO_DESIGNS.map((d) => {
            const active = value.design === d.key;
            return (
              <label
                key={d.key}
                className={cn(
                  "group flex cursor-pointer flex-col gap-2 rounded-2xl border p-2.5 transition-all duration-150",
                  active ? "border-[#5566f6] bg-[#f5f6ff] shadow-[0_0_0_3px_rgba(85,102,246,.12)]" : "border-[#ececf4] bg-white hover:border-[#c9ceee] hover:bg-[#fafbff]",
                  disabled && "cursor-default opacity-60"
                )}
              >
                <input
                  type="radio"
                  name="promo-design"
                  value={d.key}
                  checked={active}
                  disabled={disabled}
                  onChange={() => pickDesign(d.key)}
                  className="sr-only"
                  data-testid={`promo-design-${d.key}`}
                />
                <span className="block h-[68px]" aria-hidden>
                  <DesignSketch design={d.key} />
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-[13.5px] font-medium", active ? "text-[#3848c7]" : "text-[#0b1024]")}>{d.title}</span>
                  <span className="mt-0.5 block text-[12px] leading-[1.4] text-[#6f7282]">{d.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {promo.mode === "personal" ? (
          <>
            <div>
              <label className={LABEL} htmlFor="promo-percent">
                Скидка, %
              </label>
              <NumberInput id="promo-percent" value={value.discountPercent} onValue={(n) => set({ discountPercent: n })} disabled={disabled} label="Скидка, %" testId="promo-percent" max={2} />
              {!percentOk ? <p className="mt-1.5 text-[12.5px] text-[#a13a32]">От {PROMO_PERCENT_MIN} до {PROMO_PERCENT_MAX} %</p> : null}
            </div>
            <div>
              <label className={LABEL} htmlFor="promo-days">
                Срок, дней
              </label>
              <NumberInput id="promo-days" value={value.durationDays} onValue={(n) => set({ durationDays: n })} disabled={disabled} label="Срок, дней" testId="promo-days" max={2} />
              {!daysOk ? <p className="mt-1.5 text-[12.5px] text-[#a13a32]">От {PROMO_VALID_DAYS_MIN} до {PROMO_VALID_DAYS_MAX} дней</p> : null}
            </div>
          </>
        ) : null}
        <div>
          <label className={LABEL} htmlFor="promo-tariff">
            Тариф
          </label>
          <input
            id="promo-tariff"
            value={value.tariffLabel}
            disabled={disabled}
            maxLength={60}
            onChange={(e) => set({ tariffLabel: e.target.value })}
            className={INPUT}
            data-testid="promo-tariff"
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="promo-price">
            Цена в месяц, ₽
          </label>
          <NumberInput id="promo-price" value={value.priceRub} onValue={(n) => set({ priceRub: n })} disabled={disabled} label="Цена в месяц, ₽" testId="promo-price" />
          {paid && paid.priceRub !== value.priceRub ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => set({ priceRub: paid.priceRub })}
              className="mt-1.5 text-left text-[12.5px] leading-[1.5] text-[#3848c7] underline underline-offset-2 transition-colors hover:text-[#5566f6]"
              data-testid="promo-price-fill"
            >
              Сейчас «{paid.title}» стоит {rubLabel(paid.priceRub)} — подставить
            </button>
          ) : paid ? (
            <p className={HINT}>Совпадает с ценой «{paid.title}».</p>
          ) : null}
        </div>
      </div>

      {prices && promo.mode === "personal" ? (
        <p
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-[#d5f2e3] bg-[#f3fcf7] px-4 py-3 text-[14px] text-[#116b2a]"
          data-testid="promo-calc"
        >
          <span className="font-medium">
            {rubLabel(prices.oldRub)} → {rubLabel(prices.newRub)}
          </span>
          <span>, экономия {rubLabel(prices.savingRub)} в месяц</span>
        </p>
      ) : null}

      <div className="space-y-3.5">
        <div>
          <label className={LABEL} htmlFor="promo-subject">
            Тема
          </label>
          <input id="promo-subject" value={value.subject} disabled={disabled} onChange={(e) => set({ subject: e.target.value })} className={INPUT} data-testid="promo-subject" />
          <p className={HINT}>
            Подставляются: {"{имя}"}, {"{компания}"}, {"{percent}"} — скидка, {"{tariff}"}, {"{days}"} — «30 дней», {"{date}"} — «21 ноября», {"{saving}"} — экономия в месяц.
            Лучше до 70 знаков, без капса и «!!!».
          </p>
        </div>
        <div>
          <label className={LABEL} htmlFor="promo-headline">
            Заголовок
          </label>
          <input id="promo-headline" value={value.headline} disabled={disabled} onChange={(e) => set({ headline: e.target.value })} className={INPUT} data-testid="promo-headline" />
        </div>
        <div>
          <label className={LABEL} htmlFor="promo-lead">
            Текст
          </label>
          <textarea id="promo-lead" rows={3} value={value.lead} disabled={disabled} onChange={(e) => set({ lead: e.target.value })} className={TEXTAREA} data-testid="promo-lead" />
          <p className={HINT}>
            В «Личном письме» {"{offer}"} подсвечивается маркером: «−15 % на 30 дней».
          </p>
        </div>
        <div>
          <label className={LABEL} htmlFor="promo-button">
            Текст кнопки
          </label>
          <input id="promo-button" value={value.buttonText} disabled={disabled} maxLength={40} onChange={(e) => set({ buttonText: e.target.value })} className={INPUT} data-testid="promo-button" />
        </div>
        <div>
          <label className={LABEL} htmlFor="promo-benefits">
            Выгоды
          </label>
          <textarea
            id="promo-benefits"
            rows={4}
            value={benefitsDraft ?? value.benefits.join("\n")}
            disabled={disabled}
            onChange={(e) => {
              setBenefitsDraft(e.target.value);
              set({ benefits: e.target.value.split("\n") });
            }}
            onBlur={() => {
              setBenefitsDraft(null);
              set({ benefits: value.benefits.map((b) => b.trim()).filter(Boolean) });
            }}
            className={TEXTAREA}
            data-testid="promo-benefits"
          />
          <p className={HINT}>По строке на выгоду, 3–5 строк. «Северное сияние» показывает первые три.</p>
        </div>
      </div>

      <fieldset>
        <legend className={LABEL}>Промокод</legend>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
          {(
            [
              { mode: "personal", title: "Персональный каждому", text: "Свой код на каждого получателя — создаётся при отправке" },
              { mode: "existing", title: "Выбрать код", text: "Один общий код из «Промокодов» — всем" },
            ] as const
          ).map((m) => (
            <label
              key={m.mode}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 transition-colors duration-150",
                promo.mode === m.mode ? "border-[#5566f6]/40 bg-[#f5f6ff]" : "border-[#ececf4] bg-white hover:bg-[#fafbff]",
                disabled && "cursor-default opacity-60"
              )}
            >
              <input
                type="radio"
                name="promo-mode"
                value={m.mode}
                checked={promo.mode === m.mode}
                disabled={disabled}
                onChange={() => setPromo({ mode: m.mode })}
                className="mt-1 size-4 shrink-0 accent-[#5566f6]"
                data-testid={`promo-mode-${m.mode}`}
              />
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-[#0b1024]">{m.title}</span>
                <span className="block text-[12.5px] leading-[1.45] text-[#6f7282]">{m.text}</span>
              </span>
            </label>
          ))}
        </div>

        {promo.mode === "personal" ? (
          <div className="mt-3 space-y-3 rounded-2xl bg-[#fafbff] p-3.5" data-testid="promo-personal">
            <label className="flex items-start gap-2.5 text-[14px] text-[#0b1024]">
              <input
                type="checkbox"
                checked={promo.lifetime}
                disabled={disabled}
                onChange={(e) => setPromo({ lifetime: e.target.checked })}
                className="mt-0.5 size-4 shrink-0 rounded border-[#dcdfed] accent-[#5566f6]"
                data-testid="promo-lifetime"
              />
              <span>
                Скидка навсегда
                <span className="block text-[12.5px] text-[#6f7282]">После первой оплаты по коду остаётся на все следующие.</span>
              </span>
            </label>
            <p className="flex items-start gap-1.5 text-[12.5px] leading-[1.5] text-[#6f7282]">
              <Ticket className="mt-0.5 size-3.5 shrink-0 text-[#5566f6]" />
              <span>
                {daysOk && endsLabel ? `Если отправить сегодня — код действует ${endsLabel} включительно (23:59 по Москве). ` : ""}
                Коды{recipients > 0 ? ` (до ${recipients} шт.)` : ""} создадутся при отправке и будут в «Промокодах» с меткой рассылки. В предпросмотре и тесте себе —
                пример кода.
              </span>
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-2 rounded-2xl bg-[#fafbff] p-3.5" data-testid="promo-existing">
            <select
              value={promo.code ?? ""}
              disabled={disabled}
              onChange={(e) => setPromo({ code: e.target.value || null })}
              className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3 text-[15px] text-[#0b1024] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60"
              aria-label="Общий промокод"
              data-testid="promo-existing-code"
            >
              <option value="">{options.length ? "Выберите код…" : "Действующих общих кодов нет"}</option>
              {promo.code && !selected ? <option value={promo.code}>{promo.code} — не найден среди действующих общих кодов</option> : null}
              {options.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
            {selected && selected.usesLeft !== null && selected.usesLeft < recipients ? (
              <p className="flex items-start gap-1.5 text-[12.5px] leading-[1.5] text-[#a16d32]">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Код примет ещё {selected.usesLeft} оплат, а получателей выбрано {recipients} — остальным скидка не достанется.
              </p>
            ) : null}
            <p className="text-[12.5px] leading-[1.5] text-[#6f7282]">
              Размер скидки и срок письмо берёт из самого кода — поля «Скидка» и «Срок» не нужны. Новый код — в ROOT →{" "}
              <a href="/root/promo-codes" target="_blank" rel="noopener" className="text-[#3848c7] underline">
                «Промокоды»
              </a>
              .
            </p>
          </div>
        )}
        <p className={HINT}>Ссылка в письме ведёт на /promo/КОД: руководитель сразу попадёт в оплату со скидкой.</p>
      </fieldset>
    </div>
  );
}
