"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  HeartPulse,
  XCircle,
} from "lucide-react";
import type { HealthCheck } from "@/lib/org-health-check";
import { LinkPendingSpinner } from "@/components/ui/link-pending";

type Props = {
  checks: HealthCheck[];
  scorePercent: number;
  okCount: number;
  warnCount: number;
  totalCount: number;
};

/**
 * Виджет «Здоровье настройки» на /dashboard. Свёрнутый по умолчанию —
 * показывает только score «8/12» и одну строку «нажмите чтобы развернуть».
 * Развёрнутый — список всех проверок с emoji-статусами и ссылками
 * «настроить → ведёт на нужную страницу».
 */
export function OrgHealthWidget({
  checks,
  scorePercent,
  okCount,
  warnCount,
  totalCount,
}: Props) {
  const t = useTranslations("dashboardUi.orgHealthWidget");
  const params = useSearchParams();
  const focusParam = params.get("focus");
  const [open, setOpen] = useState(focusParam === "health");

  // J7 — onboarding deep-link: при `?focus=health` (или
  // `#health-check`) виджет автоматически развёрнут. Используется
  // в email-рассылках / push'ах: «нажмите тут чтобы поправить
  // настройки».
  useEffect(() => {
    if (focusParam === "health") {
      setOpen(true);
      // Прокручиваем к виджету
      const el = document.querySelector("[data-section=\"health-widget\"]");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [focusParam]);

  const tone =
    scorePercent >= 90
      ? {
          chipClass: "bg-[#ecfdf5] text-[#116b2a]",
          fgColor: "#116b2a",
          label: t("toneExcellent"),
        }
      : scorePercent >= 60
        ? {
            chipClass: "bg-[#fff8eb] text-[#7a4a00]",
            fgColor: "#7a4a00",
            label: t("toneAlmost"),
          }
        : {
            chipClass: "bg-[#fff4f2] text-[#a13a32]",
            fgColor: "#a13a32",
            label: t("toneNeedsSetup"),
          };

  return (
    <section
      data-section="health-widget"
      className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 text-left"
      >
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-2xl ${tone.chipClass}`}
        >
          <HeartPulse className="size-5" />
        </span>
        <div className="flex-1 min-w-0">
          {/* Раньше в заголовке стояло «0/8» рядом с «31%», и это
              читалось как противоречие: пункты с замечаниями дают
              половину балла, но в счётчик готовых не попадают.
              
              Процент отсюда тоже убран (2026-09-09). Выше на дашборде
              стоит «Начальная настройка — 83%», и два процента подряд,
              оба про «настройку», читались как одно и то же число,
              которое почему-то разное. Виджеты измеряют разное:
              там разовый онбординг, здесь качество текущих настроек.
              Поэтому здесь — количество замечаний, а не доля: «четыре
              замечания» говорит, что делать, а «75%» не говорит
              ничего. */}
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[#0b1024]">
            {warnCount > 0
              ? t("titleWarnings", { count: warnCount })
              : t("titleOk")}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone.chipClass}`}
            >
              {tone.label}
            </span>
          </div>
          <div className="mt-0.5 text-[12px] text-[#6f7282]">
            {t("ready", { ok: okCount, total: totalCount })}
            {" · "}
            {open ? t("clickRow") : t("clickExpand")}
          </div>
          {/* F5 — progress-bar «настройки готовы X%». Визуал прогресса
              делает онбординг ощутимее: «осталось 20% и я готов». */}
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#ececf4]">
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${scorePercent}%`,
                backgroundColor: tone.fgColor,
              }}
            />
          </div>
        </div>
        {open ? (
          <ChevronUp className="size-4 text-[#9b9fb3]" />
        ) : (
          <ChevronDown className="size-4 text-[#9b9fb3]" />
        )}
      </button>

      {open ? (
        <ul className="mt-4 space-y-1.5">
          {checks.map((c) => {
            const Icon =
              c.status === "ok"
                ? CheckCircle2
                : c.status === "warn"
                  ? AlertCircle
                  : XCircle;
            const fgClass =
              c.status === "ok"
                ? "text-[#116b2a]"
                : c.status === "warn"
                  ? "text-[#7a4a00]"
                  : "text-[#a13a32]";
            const inner = (
              <span className="flex items-start gap-2.5 rounded-xl px-2.5 py-2 hover:bg-[#fafbff]">
                <Icon
                  className={`mt-0.5 size-4 shrink-0 ${fgClass}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-[#0b1024]">
                    {c.title}
                  </span>
                  <span className="block text-[12px] text-[#6f7282]">
                    {c.hint}
                  </span>
                </span>
                <LinkPendingSpinner className="mt-0.5 shrink-0" />
              </span>
            );
            return (
              <li key={c.id}>
                {c.href && c.status !== "ok" ? (
                  <Link href={c.href} className="block">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
