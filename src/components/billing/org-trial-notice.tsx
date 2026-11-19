import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

/**
 * Свои 14 дней дополнительной организации (`lib/org-trial.ts`) — плашка
 * руководству: сколько дней осталось, по какое число и что потом нужна
 * оплаченная точка. После срока без точки вместо плашки — окно
 * `OrgTrialLockGate`, всем, кто работает в организации.
 */
export function OrgTrialNotice({
  name,
  lastDayIso,
  daysLeft,
  payHref,
  variant = "site",
}: {
  name: string;
  /** Последний бесплатный день. */
  lastDayIso: string;
  daysLeft: number;
  /** «Добавить точку» — только тем, кто может открыть тариф. */
  payHref: string | null;
  variant?: "site" | "mini";
}) {
  const t = useTranslations("billingUi.orgTrialNotice");
  const locale = useLocale();
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "Europe/Moscow" }).format(
    new Date(lastDayIso),
  );
  const spacing = variant === "site" ? "mb-4" : "mb-3";

  const urgent = daysLeft <= 3;
  return (
    <div
      role="status"
      data-testid="org-trial-notice"
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border px-3.5 py-2.5 text-[13px] leading-[1.45] ${
        urgent ? "border-[#ffd9a8] bg-[#fffaf0] text-[#7a4a00]" : "border-[#ececf4] bg-[#fafbff] text-[#3c4053]"
      } ${spacing}`}
    >
      <CalendarClock className={`size-4 shrink-0 ${urgent ? "text-[#b25e00]" : "text-[#5566f6]"}`} />
      <span className="min-w-0 flex-1">{t("message", { name, days: daysLeft, date })}</span>
      {payHref ? (
        <Link
          href={payHref}
          className="inline-flex h-8 shrink-0 items-center rounded-xl bg-[#5566f6] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
        >
          {t("action")}
        </Link>
      ) : null}
    </div>
  );
}
