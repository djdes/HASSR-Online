"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarClock, Coins, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

/**
 * «Автопродление с баланса» в «Тариф и оплата» (владелец, 2026-11-09: «по
 * примеру мобильных операторов»). Включено — в конце срока тариф
 * оплачивается с внутреннего баланса; карта не списывается. Показываем,
 * сколько и когда спишем и хватает ли денег — не хватает: «Пополнить баланс».
 */
export function AutoRenewCard({
  enabled: initialEnabled,
  canToggle,
  priceRub,
  balanceRub,
  shortRub,
  chargeDay,
  paidUntil,
  blocked,
  renewHref,
}: {
  enabled: boolean;
  /** Руководитель в своём кабинете (не ROOT «под видом»). */
  canToggle: boolean;
  priceRub: number | null;
  balanceRub: number;
  shortRub: number;
  /** «18 ноября» — день списания (МСК). */
  chargeDay: string | null;
  /** «19 ноября» — последний оплаченный день. */
  paidUntil: string | null;
  /** Запланирована смена тарифа — продлит её оплата, а не автопродление. */
  blocked: "scheduled" | null;
  /** Оплатить следующий период картой или по счёту — как раньше. */
  renewHref: string;
}) {
  const t = useTranslations("settingsUi.autoRenewCard");
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const rub = (amount: number) => `${new Intl.NumberFormat("ru-RU").format(amount)} ₽`;

  async function toggle(next: boolean) {
    setSaving(true);
    setEnabled(next);
    try {
      const response = await fetch("/api/settings/auto-renew", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; renewed?: boolean };
      if (!response.ok) {
        setEnabled(!next);
        toast.error(body.error ?? t("failed"));
        return;
      }
      toast.success(body.renewed ? t("renewedNow") : next ? t("enabledToast") : t("disabledToast"));
      router.refresh();
    } catch {
      setEnabled(!next);
      toast.error(t("failed"));
    } finally {
      setSaving(false);
    }
  }

  const covered = priceRub !== null && shortRub === 0;
  return (
    <section
      className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7"
      data-auto-renew-card
      data-auto-renew-enabled={enabled ? "on" : "off"}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <RefreshCw className="size-5" />
          </span>
          <div className="min-w-0">
            <span className="text-[16px] font-semibold text-[#0b1024]">{t("title")}</span>
            <p className="mt-1.5 max-w-[600px] text-[13.5px] leading-[1.55] text-[#6f7282]" data-auto-renew-status>
              {blocked === "scheduled"
                ? t("scheduled", { date: paidUntil ?? "—" })
                : !enabled
                  ? t("off", { date: paidUntil ?? "—" })
                  : priceRub === null
                    ? t("onNoPrice", { date: chargeDay ?? "—" })
                    : covered
                      ? t("onCovered", { date: chargeDay ?? "—", price: rub(priceRub), balance: rub(balanceRub) })
                      : t("onShort", { date: chargeDay ?? "—", price: rub(priceRub), balance: rub(balanceRub), short: rub(shortRub) })}
            </p>
            <p className="mt-1 max-w-[600px] text-[12.5px] leading-[1.5] text-[#9b9fb3]">{t("how")}</p>
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-2.5 text-[14px] font-medium text-[#0b1024]">
          {saving ? <Loader2 className="size-4 animate-spin text-[#5566f6]" /> : null}
          {enabled ? t("switchOn") : t("switchOff")}
          <Switch
            checked={enabled}
            disabled={!canToggle || saving}
            onCheckedChange={(next) => void toggle(next)}
            aria-label={t("title")}
            data-auto-renew-switch
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {enabled && !covered && blocked === null ? (
          <Link
            href="/settings/balance"
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
          >
            <Coins className="size-4" />
            {t("topUp")}
          </Link>
        ) : null}
        <Link
          href={renewHref}
          className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          <CalendarClock className="size-4 text-[#5566f6]" />
          {t("payNow")}
        </Link>
        <Link
          href="/settings/balance#history"
          className="inline-flex h-11 items-center rounded-2xl px-3 text-[14px] font-medium text-[#3848c7] transition-colors hover:bg-[#f5f6ff]"
        >
          {t("detail")}
        </Link>
      </div>
    </section>
  );
}
