"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Gift, Loader2 } from "lucide-react";

import { trialExplanation, trialPhaseLabel } from "./tariff-presentation";

/**
 * ROOT: пробный период тарифов 2026-10 и переход на оплату. Длительность
 * пробного, дата запуска (аккаунтам старше пробный считается от неё),
 * грейс на решение и флаг перехода. Сохранение сразу меняет плашку, окно
 * решения и лимиты во всех кабинетах. Ниже — сколько аккаунтов в каком
 * состоянии (аккаунт = организации одного владельца).
 */

type Kind = "exempt" | "paid" | "legacy" | "free_period" | "free" | "needs_decision";

export type TrialSettingsJson = {
  trialDays: number;
  launchedAt: string;
  graceDays: number;
  transitionEnabled: boolean;
};

export type BillingOverviewJson = {
  total: number;
  counts: Record<Kind, number>;
  paidByTier: { standard: number; premium: number; legacy: number };
  trialEndingSoon: number;
  autoTransitioned: number;
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

export function TrialSettingsCard({
  initialSettings,
  initialOverview,
}: {
  initialSettings: TrialSettingsJson;
  initialOverview: BillingOverviewJson;
}) {
  const t = useTranslations("rootTariffs");
  const currentT = useRef(t);
  useEffect(() => { currentT.current = t; }, [t]);
  const [settings, setSettings] = useState(initialSettings);
  const [overview, setOverview] = useState(initialOverview);
  const [trialDays, setTrialDays] = useState(initialSettings.trialDays);
  const [launchedAt, setLaunchedAt] = useState(toMskInput(initialSettings.launchedAt));
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
          trialDays,
          launchedAt: fromMskInput(launchedAt),
          graceDays,
          transitionEnabled: enabled,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.settings) {
        toast.error(data?.error ?? currentT.current("saveFailed"));
        return;
      }
      setSettings(data.settings);
      setOverview(data.overview);
      setSaved(true);
      toast.success(currentT.current("trialSaved"));
      window.setTimeout(() => setSaved(false), 2000);
    } catch {
      toast.error(currentT.current("networkError"));
    } finally {
      setSaving(false);
    }
  }

  const counters: Array<{ label: string; value: number; hint?: string; testId: string }> = [
    {
      label: t("paid"),
      value: overview.counts.paid,
      hint: t("paidHint", {
        standard: overview.paidByTier.standard,
        premium: overview.paidByTier.premium,
        legacy: overview.paidByTier.legacy,
      }),
      testId: "billing-count-paid",
    },
    {
      label: t("trial"),
      value: overview.counts.free_period,
      hint: t("trialHint", { count: overview.trialEndingSoon }),
      testId: "billing-count-trial",
    },
    { label: t("free"), value: overview.counts.free, testId: "billing-count-free" },
    { label: t("waiting"), value: overview.counts.needs_decision, testId: "billing-count-waiting" },
    {
      label: t("auto"),
      value: overview.autoTransitioned,
      hint: t("autoHint"),
      testId: "billing-count-auto",
    },
  ];

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
            {t("trialTitle")}
          </h2>
          <p className="mt-1 text-[13px] leading-[1.6] text-[#6f7282]">{trialPhaseLabel(t, settings)}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label={t("trialDays")}>
          <input
            type="number"
            min={1}
            max={90}
            value={trialDays}
            onChange={(e) => setTrialDays(Number(e.target.value))}
            className={inputClass + " tabular-nums"}
            data-testid="billing-trial-days"
          />
        </Field>
        <Field label={t("launchedAt")}>
          <input
            type="datetime-local"
            value={launchedAt}
            onChange={(e) => setLaunchedAt(e.target.value)}
            className={inputClass}
            data-testid="billing-launched-at"
          />
        </Field>
        <Field label={t("grace")}>
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
          {t("transition")}
        </label>
      </div>
      <p className="mt-2 text-[12px] leading-[1.6] text-[#9b9fb3]">
        {trialExplanation(t, settings)}
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

      <div className="mt-6 border-t border-[#ececf4] pt-5">
        <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          {t("total", { count: overview.total })}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
          {counters.map((c) => (
            <div key={c.testId} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
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
        {overview.counts.legacy > 0 ? (
          <p className="mt-3 text-[12.5px] text-[#6f7282]">{t("legacyCount", { count: overview.counts.legacy })}</p>
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
