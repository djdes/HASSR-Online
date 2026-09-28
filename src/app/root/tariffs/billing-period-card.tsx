"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Gift, Loader2 } from "lucide-react";

import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { SUBSCRIPTION_SEATS_LABEL, employeesGenitiveLabel } from "@/lib/plan-catalog";

/**
 * ROOT: бесплатный период «подписка до 10 сотрудников для всех» и
 * переход на оплату. Даты — по Москве; сохранение сразу меняет анонс,
 * окно решения и лимиты во всех кабинетах. Ниже — сколько аккаунтов в
 * каком состоянии (аккаунт = организации одного владельца).
 */

type Kind = "exempt" | "paid" | "legacy" | "free_period" | "free" | "needs_decision";

export type BillingPeriodSettingsJson = {
  startsAt: string;
  endsAt: string;
  graceDays: number;
  transitionEnabled: boolean;
};

export type BillingOverviewJson = {
  total: number;
  counts: Record<Kind, number>;
  autoTransitioned: number;
  forecast: Record<Kind, number> | null;
};

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** ISO → значение `datetime-local` по Москве. */
function toMskInput(iso: string): string {
  const d = new Date(new Date(iso).getTime() + MSK_OFFSET_MS);
  return d.toISOString().slice(0, 16);
}

/** `datetime-local` (МСК) → ISO. */
function fromMskInput(value: string): string {
  return new Date(`${value}:00+03:00`).toISOString();
}

function phaseLabel(settings: BillingPeriodSettingsJson, now = Date.now()): string {
  const starts = new Date(settings.startsAt).getTime();
  const ends = new Date(settings.endsAt).getTime();
  if (now < starts) return "Период ещё не начался — всё как раньше, в кабинетах анонс";
  if (now < ends) return `Идёт бесплатный период — у всех подписка ${SUBSCRIPTION_SEATS_LABEL}`;
  return settings.transitionEnabled
    ? "Период закончился — переход на оплату действует"
    : "Период закончился, но переход выключен — всё как раньше";
}

export function BillingPeriodCard({
  initialSettings,
  initialOverview,
}: {
  initialSettings: BillingPeriodSettingsJson;
  initialOverview: BillingOverviewJson;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [overview, setOverview] = useState(initialOverview);
  const [startsAt, setStartsAt] = useState(toMskInput(initialSettings.startsAt));
  const [endsAt, setEndsAt] = useState(toMskInput(initialSettings.endsAt));
  const [graceDays, setGraceDays] = useState(initialSettings.graceDays);
  const [enabled, setEnabled] = useState(initialSettings.transitionEnabled);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/root/billing-period", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startsAt: fromMskInput(startsAt),
          endsAt: fromMskInput(endsAt),
          graceDays,
          transitionEnabled: enabled,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.settings) {
        toast.error(data?.error ?? "Не удалось сохранить");
        return;
      }
      setSettings(data.settings);
      setOverview(data.overview);
      setSaved(true);
      toast.success("Бесплатный период сохранён");
      window.setTimeout(() => setSaved(false), 2000);
    } catch {
      toast.error("Сеть недоступна");
    } finally {
      setSaving(false);
    }
  }

  const counters: Array<{ label: string; value: number; hint?: string; testId: string }> = [
    { label: "Платят", value: overview.counts.paid, testId: "billing-count-paid" },
    { label: "Бесплатный", value: overview.counts.free, testId: "billing-count-free" },
    { label: "Ждут решения", value: overview.counts.needs_decision, testId: "billing-count-waiting" },
    {
      label: "Переведены автоматически",
      value: overview.autoTransitioned,
      hint: "из «Бесплатный»",
      testId: "billing-count-auto",
    },
  ];
  const secondary = [
    overview.counts.free_period ? `в бесплатном периоде: ${overview.counts.free_period}` : null,
    overview.counts.legacy ? `как раньше (тестовый режим): ${overview.counts.legacy}` : null,
  ].filter(Boolean);

  return (
    <section
      data-testid="root-billing-period"
      className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <Gift className="size-5" />
        </span>
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            Бесплатный период и переход на оплату
          </h2>
          <p className="mt-1 text-[13px] leading-[1.6] text-[#6f7282]">{phaseLabel(settings)}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Начало (МСК)">
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className={inputClass}
            data-testid="billing-starts-at"
          />
        </Field>
        <Field label="Конец (МСК, не включительно)">
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className={inputClass}
            data-testid="billing-ends-at"
          />
        </Field>
        <Field label="Грейс после конца, дней">
          <input
            type="number"
            min={0}
            max={60}
            value={graceDays}
            onChange={(e) => setGraceDays(Number(e.target.value))}
            className={inputClass + " tabular-nums"}
            data-testid="billing-grace-days"
          />
        </Field>
        <label className="flex items-end gap-2 pb-3 text-[14px] text-[#3c4053]">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-4 accent-[#5566f6]"
            data-testid="billing-transition-enabled"
          />
          Переход на оплату включён
        </label>
      </div>
      <p className="mt-2 text-[12px] leading-[1.6] text-[#9b9fb3]">
        Пока идёт период, у всех подписка {SUBSCRIPTION_SEATS_LABEL} без оплаты. После конца — у
        неоплативших бесплатный тариф на {employeesGenitiveLabel(FREE_MAX_USERS)}; у кого больше,
        руководитель выбирает в окне, а по истечении грейса остаётся владелец, остальные уходят в
        архив (ежедневная задача /api/cron/billing-transition). Выключенный переход — всё как раньше.
      </p>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          data-testid="billing-save"
          className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Сохраняем…
            </>
          ) : saved ? (
            <>
              <Check className="size-4" />
              Сохранено
            </>
          ) : (
            "Сохранить"
          )}
        </button>
      </div>

      <div className="mt-6 border-t border-[#ececf4] pt-5">
        <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          Аккаунты по состояниям · всего {overview.total}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {counters.map((c) => (
            <div key={c.label} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
              <div className="text-[12px] font-medium text-[#6f7282]">{c.label}</div>
              <div
                className="mt-1 text-[24px] font-semibold leading-none tabular-nums text-[#0b1024]"
                data-testid={c.testId}
              >
                {c.value}
              </div>
              {c.hint ? <div className="mt-1 text-[11.5px] text-[#9b9fb3]">{c.hint}</div> : null}
            </div>
          ))}
        </div>
        {secondary.length > 0 ? (
          <p className="mt-3 text-[12.5px] text-[#6f7282]">Сейчас ещё: {secondary.join(" · ")}.</p>
        ) : null}
        {overview.forecast ? (
          <p className="mt-2 text-[12.5px] text-[#6f7282]" data-testid="billing-forecast">
            Прогноз на конец периода по нынешним данным: платят {overview.forecast.paid} ·
            бесплатный {overview.forecast.free} · ждут решения {overview.forecast.needs_decision}.
          </p>
        ) : null}
      </div>
    </section>
  );
}

const inputClass =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-[#6f7282]">{label}</span>
      {children}
    </label>
  );
}
