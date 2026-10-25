"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FORMAT_LOCALES, formatNumber, type Locale } from "@/i18n/locales";

/**
 * Автопродление подписки.
 *
 * Включения кнопкой здесь нет и быть не может: касса подключает
 * автосписание только на первом платеже серии, и на уже оплаченный
 * период его не навесить. Поэтому «включить» — это оплатить месяц
 * вперёд с галочкой согласия, и кнопка ведёт на страницу оплаты.
 * Оплаченное время не сгорает: новый месяц прибавляется к текущему сроку.
 *
 * Отключение работает всегда и сразу, без подтверждений с нашей стороны —
 * так обещает оферта. Диалог здесь только затем, чтобы человек не снёс
 * автопродление случайным кликом и понимал, что доступ остаётся.
 */
export function RecurringCard({
  active,
  nextChargeAt,
  monthlyRub,
  enableHref = "/settings/subscription",
}: {
  active: boolean;
  /** Дата следующего списания = конец оплаченного периода. */
  nextChargeAt: string | null;
  monthlyRub: number;
  /** Оплата того же тарифа с галочкой автосписаний (`…&recurring=1`). */
  enableHref?: string;
}) {
  const t = useTranslations("settingsUi.recurringCard");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const nextChargeLabel = nextChargeAt
    ? new Date(nextChargeAt).toLocaleDateString(FORMAT_LOCALES[locale])
    : null;

  async function disable() {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/recurring", {
        method: "DELETE",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? t("disableFailed"));
      }
      toast.success(t("disabled"));
      setConfirmOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <RefreshCw className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[16px] font-semibold text-[#0b1024]">
                {t("title")}
              </span>
              <span
                className={
                  active
                    ? "rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[11px] font-medium text-[#116b2a]"
                    : "rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[11px] font-medium text-[#6f7282]"
                }
              >
                {active ? t("on") : t("off")}
              </span>
            </div>

            {active ? (
              <p className="mt-1.5 max-w-[560px] text-[13.5px] leading-[1.55] text-[#6f7282]">
                {t("activeIntro")}
                {nextChargeLabel ? (
                  <>
                    {" "}
                    {t.rich("nextCharge", {
                      date: nextChargeLabel,
                      amount: formatNumber(locale, monthlyRub),
                      strong: (chunks) => (
                        <span className="font-medium text-[#0b1024]">{chunks}</span>
                      ),
                    })}
                  </>
                ) : null}{" "}
                {t("activeOutro")}
              </p>
            ) : (
              <p className="mt-1.5 max-w-[560px] text-[13.5px] leading-[1.55] text-[#6f7282]">
                {t("inactiveBody")}
              </p>
            )}
          </div>
        </div>

        {active ? (
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("disable")}
          </button>
        ) : (
          <Link
            href={enableHref}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
          >
            <CalendarClock className="size-4" />
            {t("enable")}
          </Link>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={disable}
        variant="info"
        title={t("confirmTitle")}
        description={t("confirmDescription")}
        bullets={[
          nextChargeLabel
            ? { label: t("accessUntil", { date: nextChargeLabel }), tone: "info" as const }
            : { label: t("paidKept"), tone: "info" as const },
          { label: t("canReenable") },
        ]}
        confirmLabel={t("confirmLabel")}
      />
    </section>
  );
}
