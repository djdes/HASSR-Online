"use client";

import { useState } from "react";
import { ExternalLink, Info, Paperclip, Ticket } from "lucide-react";

import type { MailingKindFieldsProps } from "@/components/mailing/kind-fields";
import {
  KP_FIXED_MAX,
  KP_PERCENT_MAX,
  coerceKpPayload,
  kpDiscountLabel,
  type KpFormData,
  type KpPayload,
  type KpPromoMode,
} from "@/lib/mailing/kinds/kp-shared";
import { ORG_SPHERES } from "@/lib/org-profile";
import { promotionEndLabel } from "@/lib/promo/promotions";
import { PROMO_VALID_DAYS_MAX, PROMO_VALID_DAYS_MIN, promoEndsAfterDays } from "@/lib/promo/valid-days";
import { cn } from "@/lib/utils";

/**
 * Поля типа «КП»: сфера по умолчанию, промокод (без него / общий код /
 * персональные коды), PDF вложением. Само КП — из генератора
 * (ROOT → «Коммерческие предложения»): тексты, цена, отправитель.
 */

const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60";
const LABEL = "mb-1.5 block text-[13px] font-medium text-[#3c4053]";
const HINT = "mt-1.5 text-[12.5px] leading-[1.5] text-[#6f7282]";
const CHECKBOX = "size-4 shrink-0 rounded border-[#dcdfed] accent-[#5566f6]";

const MODES: Array<{ mode: KpPromoMode; title: string; text: string }> = [
  { mode: "none", title: "Без промокода", text: "Цены без скидки, кнопка ведёт на страницу сферы" },
  { mode: "existing", title: "Выбрать код", text: "Один общий код из «Промокодов» — всем" },
  { mode: "personal", title: "Персональные коды", text: "Каждому свой код — создаётся при отправке" },
];

/** Число с правкой «как в поле»: пока печатают — строка, после — значение из данных. */
function NumberInput({
  value,
  onValue,
  disabled,
  testId,
  label,
  className,
}: {
  value: number;
  onValue: (next: number) => void;
  disabled?: boolean;
  testId: string;
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      inputMode="numeric"
      aria-label={label}
      value={draft ?? (Number.isFinite(value) && value > 0 ? String(value) : "")}
      disabled={disabled}
      onChange={(e) => {
        const text = e.target.value.replace(/\D/g, "").slice(0, 6);
        setDraft(text);
        onValue(text === "" ? 0 : Number(text));
      }}
      onBlur={() => setDraft(null)}
      className={cn(INPUT, "tabular-nums", className)}
      data-testid={testId}
    />
  );
}

export default function KpFields({ payload, onChange, disabled, audience, formData }: MailingKindFieldsProps<KpPayload>) {
  const value = coerceKpPayload(payload);
  const data = (formData ?? null) as KpFormData | null;
  const promo = value.promo;
  const set = (patch: Partial<KpPayload>) => onChange({ ...value, ...patch });
  const setPromo = (patch: Partial<KpPayload["promo"]>) => onChange({ ...value, promo: { ...value.promo, ...patch } });

  const options = data?.promoOptions ?? [];
  const chosenCode = promo.code ? promo.code.toUpperCase() : null;
  const selected = chosenCode ? (options.find((o) => o.code === chosenCode) ?? null) : null;
  const recipients = audience.users + audience.contacts;
  const daysOk = Number.isInteger(promo.validDays) && promo.validDays >= PROMO_VALID_DAYS_MIN && promo.validDays <= PROMO_VALID_DAYS_MAX;
  const endsLabel = daysOk ? promotionEndLabel(promoEndsAfterDays(new Date(), promo.validDays)) : null;
  const valueMax = promo.kind === "percent" ? KP_PERCENT_MAX : KP_FIXED_MAX;
  const valueOk = Number.isInteger(promo.value) && promo.value >= 1 && promo.value <= valueMax;

  return (
    <div className="space-y-5" data-testid="mailing-fields-kp">
      <div>
        <label className={LABEL} htmlFor="kp-default-sphere">
          Сфера по умолчанию
        </label>
        <select
          id="kp-default-sphere"
          value={value.defaultSphere}
          disabled={disabled}
          onChange={(e) => set({ defaultSphere: e.target.value as KpPayload["defaultSphere"] })}
          className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3 text-[15px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60"
          data-testid="kp-default-sphere"
        >
          {ORG_SPHERES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <p className={HINT}>
          Каждый получит КП своей сферы: пользователи — по организации, контакты — по колонке «сфера». Эта — для тех, у
          кого сфера не указана.
        </p>
      </div>

      <fieldset>
        <legend className={LABEL}>Промокод</legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
          {MODES.map((m) => (
            <label
              key={m.mode}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 transition-colors",
                promo.mode === m.mode ? "border-[#5566f6]/40 bg-[#f5f6ff]" : "border-[#ececf4] bg-white hover:bg-[#fafbff]",
                disabled && "cursor-default opacity-60"
              )}
            >
              <input
                type="radio"
                name="kp-promo-mode"
                value={m.mode}
                checked={promo.mode === m.mode}
                disabled={disabled}
                onChange={() => setPromo({ mode: m.mode })}
                className="mt-1 size-4 shrink-0 accent-[#5566f6]"
                data-testid={`kp-mode-${m.mode}`}
              />
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-[#0b1024]">{m.title}</span>
                <span className="block text-[12.5px] leading-[1.45] text-[#6f7282]">{m.text}</span>
              </span>
            </label>
          ))}
        </div>

        {promo.mode === "existing" ? (
          <div className="mt-3 space-y-2 rounded-2xl bg-[#fafbff] p-3.5" data-testid="kp-existing">
            <select
              value={promo.code ?? ""}
              disabled={disabled}
              onChange={(e) => setPromo({ code: e.target.value || null })}
              className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3 text-[15px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60"
              aria-label="Общий промокод"
              data-testid="kp-existing-code"
            >
              <option value="">{options.length ? "Выберите код…" : "Действующих общих кодов нет"}</option>
              {promo.code && !selected ? (
                <option value={promo.code}>{promo.code} — не найден среди действующих общих кодов</option>
              ) : null}
              {options.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
            {selected && selected.usesLeft !== null && selected.usesLeft < recipients ? (
              <p className="flex items-start gap-1.5 text-[12.5px] leading-[1.5] text-[#a16d32]">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                Код примет ещё {selected.usesLeft} оплат, а получателей выбрано {recipients} — остальным скидка не
                достанется.
              </p>
            ) : null}
            <p className="text-[12.5px] leading-[1.5] text-[#6f7282]">
              В списке — включённые коды без привязки к почте или организации, не исчерпанные и не одноразовые. Новый код
              — в ROOT →{" "}
              <a href="/root/promo-codes" target="_blank" rel="noopener" className="text-[#3848c7] underline">
                «Промокоды»
              </a>
              .
            </p>
          </div>
        ) : null}

        {promo.mode === "personal" ? (
          <div className="mt-3 space-y-3 rounded-2xl bg-[#fafbff] p-3.5" data-testid="kp-personal">
            <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
              <div className="flex rounded-2xl border border-[#dcdfed] bg-white p-1">
                {(["percent", "fixed"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    disabled={disabled}
                    onClick={() => setPromo({ kind })}
                    className={cn(
                      "h-9 flex-1 rounded-xl text-[13.5px] transition-colors duration-150",
                      promo.kind === kind ? "bg-[#eef1ff] font-medium text-[#3848c7]" : "text-[#6f7282] hover:bg-[#f5f6ff]"
                    )}
                    data-testid={`kp-kind-${kind}`}
                  >
                    {kind === "percent" ? "Процент" : "Рубли"}
                  </button>
                ))}
              </div>
              <NumberInput
                value={promo.value}
                onValue={(next) => setPromo({ value: next })}
                disabled={disabled}
                label={promo.kind === "percent" ? "Скидка, %" : "Скидка, ₽"}
                testId="kp-value"
              />
            </div>
            {!valueOk ? (
              <p className="text-[12.5px] text-[#a13a32]">
                {promo.kind === "percent" ? `Скидка — от 1 до ${KP_PERCENT_MAX} %` : `Скидка — от 1 до ${KP_FIXED_MAX.toLocaleString("ru-RU")} ₽`}
              </p>
            ) : null}
            <label className="flex items-start gap-2.5 text-[14px] text-[#0b1024]">
              <input
                type="checkbox"
                checked={promo.lifetime}
                disabled={disabled}
                onChange={(e) => setPromo({ lifetime: e.target.checked })}
                className={cn(CHECKBOX, "mt-0.5")}
                data-testid="kp-lifetime"
              />
              <span>
                Скидка навсегда
                <span className="block text-[12.5px] text-[#6f7282]">После первой оплаты по коду остаётся на все следующие.</span>
              </span>
            </label>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[14px] text-[#0b1024]">
                <span>Код действует</span>
                <NumberInput
                  value={promo.validDays}
                  onValue={(next) => setPromo({ validDays: next })}
                  disabled={disabled}
                  label="Срок кода, дней"
                  testId="kp-days"
                  className="h-10 w-[76px] px-2.5 text-center"
                />
                <span>дн.</span>
              </div>
              <p className={HINT} data-testid="kp-days-hint">
                {daysOk
                  ? `Если отправить сегодня — ${endsLabel} включительно (23:59 по Москве).${
                      promo.lifetime ? " Кто оплатит до этого дня, сохранит скидку навсегда." : ""
                    }`
                  : `Срок — от ${PROMO_VALID_DAYS_MIN} до ${PROMO_VALID_DAYS_MAX} дней.`}
              </p>
            </div>
            <p className="flex items-start gap-1.5 text-[12.5px] leading-[1.5] text-[#6f7282]">
              <Ticket className="mt-0.5 size-3.5 shrink-0 text-[#5566f6]" />
              <span>
                {valueOk ? `${kpDiscountLabel(promo.kind, promo.value)}${promo.lifetime ? " навсегда" : ""}, одна оплата по коду. ` : ""}
                Пользователям — код их организации, загруженным контактам — код без привязки к почте (КП могут переслать
                тому, кто оплачивает). Коды создадутся при отправке{recipients > 0 ? ` — до ${recipients} шт.` : ""} и будут в
                «Промокодах» с меткой рассылки. В предпросмотре и тесте себе — пример кода.
              </span>
            </p>
          </div>
        ) : null}
      </fieldset>

      <label className="flex items-start gap-2.5 text-[14px] text-[#0b1024]">
        <input
          type="checkbox"
          checked={value.attachPdf}
          disabled={disabled}
          onChange={(e) => set({ attachPdf: e.target.checked })}
          className={cn(CHECKBOX, "mt-0.5")}
          data-testid="kp-attach-pdf"
        />
        <span>
          <span className="inline-flex items-center gap-1.5">
            <Paperclip className="size-3.5 text-[#5566f6]" /> Вложить PDF
          </span>
          <span className="block text-[12.5px] leading-[1.5] text-[#6f7282]">
            Вложения повышают риск попасть в спам. В письме и так есть «Скачать PDF» и веб-версия.
          </span>
        </span>
      </label>

      <p className="rounded-2xl border border-[#ececf4] bg-white px-3.5 py-3 text-[13px] leading-[1.55] text-[#3c4053]">
        Отправитель в КП: <b className="font-medium text-[#0b1024]">{data?.senderName ?? "Команда WeSetup"}</b>
        {data && !data.senderName ? " (свой не настроен)" : ""}.{" "}
        <a
          href="/root/proposals"
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 text-[#3848c7] underline"
          data-testid="kp-sender-link"
        >
          Отправитель и реквизиты — ROOT → «Коммерческие предложения»
          <ExternalLink className="size-3.5" />
        </a>
      </p>
    </div>
  );
}
