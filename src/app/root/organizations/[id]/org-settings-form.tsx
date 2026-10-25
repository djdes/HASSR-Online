"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { organizationError } from "./organization-presentation";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

/**
 * Правка карточки организации из ROOT-панели.
 *
 * Название, тариф и срок подписки раньше менялись только руками в базе:
 * на просьбу клиента «продлите нам месяц» уходил заход на сервер.
 * Тарифы 2026-10: «Стандарт»/«Премиум», период оплаты и точки пишутся в
 * аккаунт; там же — продление пробного периода.
 */

const PLANS = [
  { value: "free", label: "plans.free" },
  { value: "standard", label: "plans.standard" },
  { value: "premium", label: "plans.premium" },
  { value: "paid", label: "plans.paid" },
  { value: "paused", label: "plans.paused" },
  { value: "cancelled", label: "plans.cancelled" },
] as const;

type AccountPlan = { planCycle: "month" | "year"; planPoints: number; trialEndsAt: string | null };

/** `Date` → `YYYY-MM-DD` для `<input type="date">`. */
function toDateInput(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}

export function OrgSettingsForm({
  organizationId,
  initialName,
  initialPlan,
  initialSubscriptionEnd,
  account = null,
}: {
  organizationId: string;
  initialName: string;
  initialPlan: string;
  /** ISO-строка или null. */
  initialSubscriptionEnd: string | null;
  /** Тариф аккаунта; null — организация без аккаунта (только тариф и срок). */
  account?: AccountPlan | null;
}) {
  const t = useTranslations("rootOrganizationManagement");
  const currentCopy = useRef(t);
  currentCopy.current = t;
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [plan, setPlan] = useState(initialPlan);
  const [endsAt, setEndsAt] = useState(toDateInput(initialSubscriptionEnd));
  const [cycle, setCycle] = useState(account?.planCycle ?? "month");
  const [points, setPoints] = useState(account?.planPoints ?? 1);
  const [trialEndsAt, setTrialEndsAt] = useState(toDateInput(account?.trialEndsAt ?? null));
  const [busy, setBusy] = useState(false);

  const accountDirty =
    Boolean(account) &&
    (cycle !== account!.planCycle || points !== account!.planPoints || trialEndsAt !== toDateInput(account!.trialEndsAt));
  const dirty =
    name !== initialName ||
    plan !== initialPlan ||
    endsAt !== toDateInput(initialSubscriptionEnd) ||
    accountDirty;

  async function save() {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/root/organizations/${organizationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            subscriptionPlan: plan,
            // Пустая дата — бессрочная подписка, а не «сегодня».
            subscriptionEnd: endsAt ? `${endsAt}T00:00:00.000Z` : null,
            ...(account
              ? {
                  planCycle: cycle,
                  planPoints: points,
                  // Пробный до конца выбранного дня по Москве; пусто — 14 дней от создания.
                  trialEndsAt: trialEndsAt ? `${trialEndsAt}T21:00:00.000Z` : null,
                }
              : {}),
          }),
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(organizationError(data, currentCopy.current, "settings.failed"));
        return;
      }
      toast.success(currentCopy.current("settings.saved"));
      router.refresh();
    } catch {
      toast.error(currentCopy.current("settings.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="space-y-1.5">
        <span className="block text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          {t("settings.name")}</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-10 w-full rounded-xl border border-[#dcdfed] px-3.5 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        />
      </label>

      <label className="space-y-1.5">
        <span className="block text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          {t("subscription.plan")}</span>
        <select
          value={plan}
          onChange={(event) => setPlan(event.target.value)}
          className="h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        >
          {!PLANS.some(item => item.value === plan) ? <option value={plan}>{plan}</option> : null}
          {PLANS.map((item) => (
            <option key={item.value} value={item.value}>
              {t(item.label)}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1.5">
        <span className="block text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          {t("subscription.until")}</span>
        <input
          type="date"
          value={endsAt}
          onChange={(event) => setEndsAt(event.target.value)}
          className="h-10 w-full rounded-xl border border-[#dcdfed] px-3.5 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        />
        <span className="block text-[11px] text-[#9b9fb3]">
          {t("settings.noExpiry")}</span>
      </label>

      {account ? (
        <>
          <label className="space-y-1.5">
            <span className="block text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              {t("subscription.cycle")}</span>
            <select
              value={cycle}
              onChange={(event) => setCycle(event.target.value === "year" ? "year" : "month")}
              className="h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            >
              <option value="month">{t("subscription.cycleMonth")}</option>
              <option value="year">{t("subscription.cycleYear")}</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="block text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              {t("subscription.points")}</span>
            <input
              type="number"
              min={1}
              max={50}
              value={points}
              onChange={(event) => setPoints(Math.max(1, Math.min(50, Math.floor(Number(event.target.value) || 1))))}
              className="h-10 w-full rounded-xl border border-[#dcdfed] px-3.5 text-[14px] tabular-nums text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </label>
          <label className="space-y-1.5">
            <span className="block text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              {t("subscription.trialEnds")}</span>
            <input
              type="date"
              value={trialEndsAt}
              onChange={(event) => setTrialEndsAt(event.target.value)}
              className="h-10 w-full rounded-xl border border-[#dcdfed] px-3.5 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <span className="block text-[11px] text-[#9b9fb3]">
              {t("settings.trialHint")}</span>
          </label>
        </>
      ) : null}

      <div className="sm:col-span-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !dirty}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#5566f6] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {dirty ? t("settings.save") : t("settings.saved")}
        </button>
      </div>
    </div>
  );
}
