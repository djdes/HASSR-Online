"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { fieldDiscountLabel, fieldPromoOptionLabel, fieldSphereLabel, fieldNumber } from "@/lib/mailing/kind-fields-presentation";
import { ExternalLink, Info, Paperclip, Ticket } from "lucide-react";

import type { MailingKindFieldsProps } from "@/components/mailing/kind-fields";
import {
  KP_FIXED_MAX,
  KP_PERCENT_MAX,
  coerceKpPayload,
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

const MODES: KpPromoMode[] = ["none", "existing", "personal"];

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
  const locale = useLocale() as Locale;
  const t = useTranslations("rootMailingKindFields");
  const sphereT = useTranslations("rootMailingShellAudience");
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
  const endsLabel = daysOk ? promotionEndLabel(promoEndsAfterDays(new Date(), promo.validDays), locale) : null;
  const valueMax = promo.kind === "percent" ? KP_PERCENT_MAX : KP_FIXED_MAX;
  const valueOk = Number.isInteger(promo.value) && promo.value >= 1 && promo.value <= valueMax;

  return (
    <div className="space-y-5" data-testid="mailing-fields-kp">
      <div>
        <label className={LABEL} htmlFor="kp-default-sphere">
          {t("kp.sphere")}
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
              {fieldSphereLabel(s.value, s.label, sphereT)}
            </option>
          ))}
        </select>
        <p className={HINT}>
          {t("kp.sphereHint")}
        </p>
      </div>

      <fieldset>
        <legend className={LABEL}>{t("kp.promo")}</legend>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
          {MODES.map((m) => (
            <label
              key={m}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3 transition-colors",
                promo.mode === m ? "border-[#5566f6]/40 bg-[#f5f6ff]" : "border-[#ececf4] bg-white hover:bg-[#fafbff]",
                disabled && "cursor-default opacity-60"
              )}
            >
              <input
                type="radio"
                name="kp-promo-mode"
                value={m}
                checked={promo.mode === m}
                disabled={disabled}
                onChange={() => setPromo({ mode: m })}
                className="mt-1 size-4 shrink-0 accent-[#5566f6]"
                data-testid={`kp-mode-${m}`}
              />
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-[#0b1024]">{t(`kp.modes.${m}.title`)}</span>
                <span className="block text-[12.5px] leading-[1.45] text-[#6f7282]">{t(`kp.modes.${m}.hint`)}</span>
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
              aria-label={t("kp.existingAria")}
              data-testid="kp-existing-code"
            >
              <option value="">{options.length ? t("kp.chooseCode") : t("kp.noCodes")}</option>
              {promo.code && !selected ? (
                <option value={promo.code}>{t("kp.missingCode", { code: promo.code })}</option>
              ) : null}
              {options.map((o) => (
                <option key={o.code} value={o.code}>
                  {fieldPromoOptionLabel(o, locale, (args) => t("kp.option", args))}
                </option>
              ))}
            </select>
            {selected && selected.usesLeft !== null && selected.usesLeft < recipients ? (
              <p className="flex items-start gap-1.5 text-[12.5px] leading-[1.5] text-[#a16d32]">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                {t("kp.remainingWarning", { uses: String(selected.usesLeft), recipients: String(recipients) })}
              </p>
            ) : null}
            <p className="text-[12.5px] leading-[1.5] text-[#6f7282]">
              {t.rich("kp.existingHint", {
                link: (chunks) => <a href="/root/promo-codes" target="_blank" rel="noopener" className="text-[#3848c7] underline">{chunks}</a>,
              })}
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
                    {t(kind === "percent" ? "kp.kindPercent" : "kp.kindFixed")}
                  </button>
                ))}
              </div>
              <NumberInput
                value={promo.value}
                onValue={(next) => setPromo({ value: next })}
                disabled={disabled}
                label={t(promo.kind === "percent" ? "kp.percentAria" : "kp.fixedAria")}
                testId="kp-value"
              />
            </div>
            {!valueOk ? (
              <p className="text-[12.5px] text-[#a13a32]">
                {promo.kind === "percent" ? t("kp.invalidPercent", { max: String(KP_PERCENT_MAX) }) : t("kp.invalidFixed", { max: fieldNumber(KP_FIXED_MAX, locale) })}
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
                {t("kp.lifetime")}
                <span className="block text-[12.5px] text-[#6f7282]">{t("kp.lifetimeHint")}</span>
              </span>
            </label>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[14px] text-[#0b1024]">
                <span>{t("kp.validFor")}</span>
                <NumberInput
                  value={promo.validDays}
                  onValue={(next) => setPromo({ validDays: next })}
                  disabled={disabled}
                  label={t("kp.daysAria")}
                  testId="kp-days"
                  className="h-10 w-[76px] px-2.5 text-center"
                />
                <span>{t("kp.daysAbbrev")}</span>
              </div>
              <p className={HINT} data-testid="kp-days-hint">
                {daysOk
                  ? t("kp.endHint", { end: endsLabel!, lifetime: promo.lifetime ? "yes" : "no" })
                  : t("kp.invalidDays", { min: String(PROMO_VALID_DAYS_MIN), max: String(PROMO_VALID_DAYS_MAX) })}
              </p>
            </div>
            <p className="flex items-start gap-1.5 text-[12.5px] leading-[1.5] text-[#6f7282]">
              <Ticket className="mt-0.5 size-3.5 shrink-0 text-[#5566f6]" />
              <span>
                {valueOk ? t("kp.personalSummary", { discount: fieldDiscountLabel(promo.kind, promo.value, locale), lifetime: promo.lifetime ? "yes" : "no" }) : ""}
                {t("kp.personalInfo", { countState: recipients > 0 ? "positive" : "none", count: String(recipients) })}
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
            <Paperclip className="size-3.5 text-[#5566f6]" /> {t("kp.attachPdf")}
          </span>
          <span className="block text-[12.5px] leading-[1.5] text-[#6f7282]">
            {t("kp.attachHint")}
          </span>
        </span>
      </label>

      <p className="rounded-2xl border border-[#ececf4] bg-white px-3.5 py-3 text-[13px] leading-[1.55] text-[#3c4053]">
        {t.rich("kp.senderLine", {
          name: data?.senderName ?? "Команда WeSetup", unset: data && !data.senderName ? "yes" : "no",
          sender: (chunks) => <b className="font-medium text-[#0b1024]">{chunks}</b>,
        })}
        <a
          href="/root/proposals"
          target="_blank"
          rel="noopener"
          className="inline-flex items-center gap-1 text-[#3848c7] underline"
          data-testid="kp-sender-link"
        >
          {t("kp.senderLink")}
          <ExternalLink className="size-3.5" />
        </a>
      </p>
    </div>
  );
}
