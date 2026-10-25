"use client";

import { useState, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { TariffComparison } from "@/components/pricing/tariff-comparison";
import type { BillingCycle, PaidTier } from "@/lib/tariff-plans";

/**
 * Витрина тарифов в кабинете: та же `TariffComparison`, что на лендинге,
 * плюс запрос «перейти с конца срока» и его отмена. Повышение и продление —
 * ссылками на /order (сумму считает сервер), здесь только понижение,
 * за которое сейчас платить нечего.
 */
export function CabinetTariffs(
  props: Omit<ComponentProps<typeof TariffComparison>, "mode" | "onSchedule" | "onCancelSchedule" | "scheduleBusy">
) {
  const t = useTranslations("settingsUi.subscriptionPage");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function send(method: "POST" | "DELETE", target?: { tier: PaidTier; cycle: BillingCycle; points: number }) {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/subscription/schedule", {
        method,
        headers: { "Content-Type": "application/json" },
        body: target ? JSON.stringify({ plan: target.tier, cycle: target.cycle, points: target.points }) : undefined,
      });
      const data = (await response.json().catch(() => null)) as { error?: string; atLabel?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? t("scheduleFailed"));
      toast.success(method === "POST" ? t("scheduleDone", { date: data?.atLabel ?? "" }) : t("scheduleCancelled"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("scheduleFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TariffComparison
      {...props}
      mode="cabinet"
      scheduleBusy={busy}
      onSchedule={(target) => void send("POST", target)}
      onCancelSchedule={() => void send("DELETE")}
    />
  );
}

/** «Отменить переход» в карточке «Ваш тариф». */
export function CancelScheduleButton() {
  const t = useTranslations("settingsUi.subscriptionPage");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/subscription/schedule", { method: "DELETE" });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? t("scheduleFailed"));
      toast.success(t("scheduleCancelled"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("scheduleFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void cancel()}
      disabled={busy}
      data-testid="subscription-cancel-schedule"
      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : null}
      {t("scheduleCancel")}
    </button>
  );
}
