"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Archive, Check, Loader2 } from "lucide-react";
import type { Tariff } from "@/lib/tariffs";
import { CYCLE_MONTHS, parsePlanTariffKey } from "@/lib/tariff-plans";

/**
 * Inline-правка тарифов. Форма на каждую строку: цена, название и
 * признак «в продаже». Сохраняем по строке, а не всё скопом — так
 * понятнее, что именно поменялось, и одна опечатка не блокирует
 * сохранение соседнего тарифа.
 *
 * Тарифы 2026-10 — четыре строки («Стандарт» и «Премиум», помесячно и за
 * год), цена — за месяц; срок задаёт период. Прежние «Подписки» — в
 * архиве: по ним не продаём, цена `monthly` нужна для зачёта остатка.
 */
export function TariffsClient({ initial }: { initial: Tariff[] }) {
  const t = useTranslations("rootTariffs");
  const [rows, setRows] = useState<Tariff[]>(initial);

  const patch = (key: string, changes: Partial<Tariff>) =>
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...changes } : r)),
    );
  const plans = rows.filter((row) => parsePlanTariffKey(row.key));
  const legacy = rows.filter((row) => !parsePlanTariffKey(row.key));

  return (
    <div className="space-y-4">
      {plans.map((tariff) => (
        <TariffRow
          key={tariff.key}
          tariff={tariff}
          onChange={(changes) => patch(tariff.key, changes)}
        />
      ))}
      {legacy.length > 0 ? (
        <details className="group rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-5 md:p-6">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-[14px] font-medium text-[#3c4053]">
            <Archive className="size-4 text-[#6f7282]" />
            {t("legacyTitle", { count: legacy.length })}
          </summary>
          <p className="mt-2 text-[12.5px] leading-[1.6] text-[#6f7282]">{t("legacyNote")}</p>
          <div className="mt-4 space-y-4">
            {legacy.map((tariff) => (
              <TariffRow
                key={tariff.key}
                tariff={tariff}
                legacy
                onChange={(changes) => patch(tariff.key, changes)}
              />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function TariffRow({
  tariff,
  legacy = false,
  onChange,
}: {
  tariff: Tariff;
  /** Прежняя «Подписка»: не продаётся, без переключателя. */
  legacy?: boolean;
  onChange: (changes: Partial<Tariff>) => void;
}) {
  const t = useTranslations("rootTariffs");
  const locale = useLocale();
  const plan = parsePlanTariffKey(tariff.key);
  const currentT = useRef(t);
  useEffect(() => { currentT.current = t; }, [t]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/root/tariffs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: tariff.key,
          title: tariff.title,
          priceRub: tariff.priceRub,
          ...(plan ? {} : { periodDays: tariff.periodDays }),
          ...(legacy ? {} : { active: tariff.active }),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? currentT.current("saveFailed"));
        return;
      }
      setSaved(true);
      toast.success(currentT.current("tariffSaved", { title: tariff.title }));
      window.setTimeout(() => setSaved(false), 2000);
    } catch {
      toast.error(currentT.current("networkError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="rounded-full bg-[#f5f6ff] px-2.5 py-1 font-mono text-[12px] text-[#3848c7]">
          {tariff.key}
        </span>
        {legacy ? (
          <span className="text-[12.5px] text-[#9b9fb3]">{t("legacyBadge")}</span>
        ) : (
          <label className="inline-flex items-center gap-2 text-[13px] text-[#3c4053]">
            <input
              type="checkbox"
              checked={tariff.active}
              onChange={(e) => onChange({ active: e.target.checked })}
              className="size-4 accent-[#5566f6]"
            />
            {tariff.active ? t("active") : t("inactive")}
          </label>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_160px_140px]">
        <Field label={t("name")}>
          <input
            value={tariff.title}
            onChange={(e) => onChange({ title: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label={plan ? t("priceMonthly") : t("price")}>
          <input
            type="number"
            min={1}
            max={1000000}
            value={tariff.priceRub}
            onChange={(e) => onChange({ priceRub: Number(e.target.value) })}
            className={inputClass + " tabular-nums"}
          />
        </Field>
        <Field label={t("periodDays")}>
          <input
            type="number"
            min={1}
            max={366}
            value={tariff.periodDays}
            disabled={Boolean(plan)}
            onChange={(e) => onChange({ periodDays: Number(e.target.value) })}
            className={inputClass + " tabular-nums disabled:bg-[#fafbff] disabled:text-[#6f7282]"}
          />
        </Field>
      </div>

      {plan?.cycle === "year" ? (
        <p className="mt-3 text-[12px] leading-[1.6] text-[#9b9fb3]">
          {t("yearTotal", {
            amount: `${(tariff.priceRub * CYCLE_MONTHS.year).toLocaleString(locale)} ₽`,
          })}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t("saving")}
            </>
          ) : saved ? (
            <>
              <Check className="size-4" />
              {t("saved")}
            </>
          ) : (
            t("save")
          )}
        </button>
      </div>
    </div>
  );
}

const inputClass =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">
        {label}
      </div>
      {children}
    </div>
  );
}
