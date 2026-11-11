"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";

import { dayLeft } from "@/lib/day-deadline";
import { cn } from "@/lib/utils";

/**
 * «До конца дня 3 ч 20 мин · осталось 12» на «Сегодня» (08.11.2026).
 * Граница дня считается на сервере (`dayDeadline`: час конца смены
 * организации в её поясе), остаток — здесь, раз в минуту. Меньше часа —
 * предупреждающий цвет. Перевалили за полночь — страница обновляется сама:
 * «Сегодня» уже другой день.
 */
export function TodayStatus({
  deadlineIso,
  closeLabel,
  unfilled,
  rollsOverAtDeadline,
}: {
  deadlineIso: string;
  closeLabel: string;
  unfilled: number;
  /** Граница — полночь: после неё наступает новый день, страницу обновляем. */
  rollsOverAtDeadline: boolean;
}) {
  const t = useTranslations("dashboardUi.todaySpeed");
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);
  const deadline = new Date(deadlineIso);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const left = now ? dayLeft(deadline, now) : null;
  useEffect(() => {
    if (left?.kind === "closed" && rollsOverAtDeadline) router.refresh();
    // Обновляем один раз — когда остаток впервые стал «закрыт».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left?.kind, rollsOverAtDeadline]);

  // До гидрации (и без часов) строка не рисуется — сервер не знает минуту клиента.
  if (!left) return null;

  const text =
    unfilled === 0
      ? t("allDone")
      : left.kind === "closed"
        ? t("closed", { time: closeLabel })
        : left.hours > 0
          ? t("leftHM", { hours: String(left.hours), minutes: String(left.minutes) })
          : t("leftM", { minutes: String(left.minutes) });
  const tone = unfilled === 0 ? "done" : left.kind === "closed" || left.urgent ? "warn" : "calm";

  return (
    <div
      data-testid="today-status"
      data-tone={tone}
      role="status"
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-[13.5px] font-medium tabular-nums newd:hidden",
        tone === "done" && "bg-[#ecfdf5] text-[#116b2a]",
        tone === "warn" && "bg-[#fff4f2] text-[#a13a32]",
        tone === "calm" && "bg-[#f5f6ff] text-[#3848c7]",
      )}
    >
      <Clock className="size-4 shrink-0" aria-hidden />
      <span>
        {text}
        {unfilled > 0 ? <span className="font-normal"> · {t("remaining", { count: unfilled })}</span> : null}
      </span>
    </div>
  );
}

/**
 * Число незаполненных — в заголовке вкладки «(12) Сегодня…» и на значке
 * установленного приложения (`navigator.setAppBadge`). Уходя со страницы,
 * снимаем только свой префикс: заголовок новой страницы ставит Next.
 */
export function TodayTabBadge({ unfilled }: { unfilled: number }) {
  useEffect(() => {
    const strip = (title: string) => title.replace(/^\(\d+\)\s/, "");
    // Заголовок могут переписать после нас (метаданные страницы, обновление
    // данных) — следим за <head> и возвращаем число. Сравнение строк — дёшево.
    const apply = () => {
      const base = strip(document.title);
      const want = unfilled > 0 ? `(${unfilled}) ${base}` : base;
      if (document.title !== want) document.title = want;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    try {
      if (unfilled > 0) void nav.setAppBadge?.(unfilled)?.catch?.(() => undefined);
      else void nav.clearAppBadge?.()?.catch?.(() => undefined);
    } catch {
      /* значки приложений не поддерживаются — ничего не делаем */
    }
    return () => {
      observer.disconnect();
      document.title = strip(document.title);
    };
  }, [unfilled]);
  return null;
}
