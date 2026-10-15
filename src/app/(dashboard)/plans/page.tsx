import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { resolveSectionName } from "@/lib/org-custom-names";
import { db } from "@/lib/db";
import { getTranslations } from "next-intl/server";
import { getSiteLocale } from "@/i18n/site-locale-server";
import { FORMAT_LOCALES, formatNumber } from "@/i18n/locales";

type PlanItem = {
  sku: string;
  targetQuantity: number;
  actualQuantity?: number;
  priority?: string;
};

function getPlanItems(items: unknown): PlanItem[] {
  if (Array.isArray(items)) return items as PlanItem[];
  return [];
}

export default async function PlansPage() {
  const session = await requireAuth();
  const locale = await getSiteLocale();
  const t = await getTranslations({ locale, namespace: "productionPlans" });
  const dateFormat = new Intl.DateTimeFormat(FORMAT_LOCALES[locale]);
  const dayFormat = new Intl.DateTimeFormat(FORMAT_LOCALES[locale], { weekday: "short", day: "numeric", month: "2-digit" });
  const SHIFT_LABELS: Record<string, string> = {
    day: t("shifts.day"),
    morning: t("shifts.morning"),
    evening: t("shifts.evening"),
    night: t("shifts.night"),
  };

  const STATUS_INFO: Record<string, { label: string; bg: string; fg: string }> = {
    draft: { label: t("statuses.draft"), bg: "#fafbff", fg: "#6f7282" },
    active: { label: t("statuses.active"), bg: "#eef1ff", fg: "#3848c7" },
    completed: { label: t("statuses.completed"), bg: "#ecfdf5", fg: "#116b2a" },
  };

  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const plans = await db.productionPlan.findMany({
    where: {
      organizationId: getActiveOrgId(session),
      date: { gte: weekStart, lte: weekEnd },
    },
    orderBy: { date: "asc" },
  });

  const days: { date: Date; label: string; plans: typeof plans }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dayPlans = plans.filter((p) => {
      const pd = new Date(p.date);
      return pd.toDateString() === d.toDateString();
    });
    days.push({
      date: d,
      label: dayFormat.format(d),
      plans: dayPlans,
    });
  }

  const todayStr = today.toDateString();

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
            {/* Своё название раздела организации, если его задали. */}
            {await resolveSectionName(getActiveOrgId(session), "plans", t("title"))}
          </h1>
          <p className="mt-1.5 text-[14px] text-[#6f7282]">
            {t("week", { start: dateFormat.format(weekStart), end: dateFormat.format(weekEnd) })}
          </p>
        </div>
        <Link
          href="/plans/new"
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] sm:w-auto sm:justify-start sm:self-start"
        >
          <Plus className="size-4" />
          {t("newTitle")}
        </Link>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="grid min-w-[980px] grid-cols-7 gap-3 lg:min-w-0">
          {days.map((day) => {
            const isToday = day.date.toDateString() === todayStr;

            return (
              <div
                key={day.date.getTime()}
                className={`rounded-2xl border bg-white p-3 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] ${
                  isToday
                    ? "border-[#5566f6]/60 ring-1 ring-[#5566f6]/25"
                    : "border-[#ececf4]"
                }`}
              >
                <div
                  className={`text-[13px] font-semibold ${
                    isToday ? "text-[#3848c7]" : "text-[#0b1024]"
                  }`}
                >
                  {day.label}
                </div>
                <div className="mt-3 space-y-2">
                  {day.plans.map((plan) => {
                    const items = getPlanItems(plan.items);
                    const totalTarget = items.reduce(
                      (s, i) => s + i.targetQuantity,
                      0
                    );
                    const totalActual = items.reduce(
                      (s, i) => s + (i.actualQuantity || 0),
                      0
                    );
                    const completion =
                      totalTarget > 0
                        ? Math.round((totalActual / totalTarget) * 100)
                        : 0;
                    const statusInfo =
                      Object.hasOwn(STATUS_INFO, plan.status) ? STATUS_INFO[plan.status] : { ...STATUS_INFO.draft, label: plan.status };

                    return (
                      <div
                        key={plan.id}
                        className="space-y-1.5 rounded-xl border border-[#ececf4] bg-[#fafbff] p-2"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="inline-flex items-center rounded-full border border-[#ececf4] bg-white px-2 py-0.5 text-[10px] text-[#3c4053]">
                            {Object.hasOwn(SHIFT_LABELS, plan.shift) ? SHIFT_LABELS[plan.shift] : plan.shift}
                          </span>
                          <span
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: statusInfo.bg,
                              color: statusInfo.fg,
                            }}
                          >
                            {statusInfo.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#6f7282]">
                          {t("itemsCount", { count: items.length })}
                        </p>
                        {plan.status !== "draft" && totalTarget > 0 && (
                          <div className="space-y-0.5">
                            <div className="h-1.5 overflow-hidden rounded-full bg-[#ececf4]">
                              <div
                                className={`h-full rounded-full ${
                                  completion >= 100
                                    ? "bg-[#5fc88a]"
                                    : completion >= 70
                                    ? "bg-[#d9a02a]"
                                    : "bg-[#d95f2a]"
                                }`}
                                style={{
                                  width: `${Math.min(completion, 100)}%`,
                                }}
                              />
                            </div>
                            <p className="text-[10px] text-[#9b9fb3] tabular-nums">
                              {formatNumber(locale, completion / 100, { style: "percent", maximumFractionDigits: 0 })}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {day.plans.length === 0 && (
                    <p className="py-2 text-center text-[11px] text-[#9b9fb3]">
                      {t("emptyDay")}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
