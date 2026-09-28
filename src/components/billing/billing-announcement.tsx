"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Gift, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Анонс бесплатного периода: «С 1 по 10 октября подписка «до 10
 * сотрудников» бесплатна для всех. С 11 октября — 1 990 ₽/мес или
 * бесплатный тариф на 1 сотрудника». Видят все роли — наверху главной
 * (дашборд руководителя, журналы сотрудника) и в профиле мини-приложения.
 * Закрывается на день: завтра покажется снова, пока идёт период.
 *
 * Тексты считает сервер (`announcementText`): даты — из настроек ROOT,
 * цена — из тарифа. Организациям с оплаченной подпиской не рендерится.
 */
const DISMISS_KEY = "wesetup.billing-announcement.dismissed-day";

export function BillingAnnouncement({
  lead,
  tail,
  href,
  dayKey,
  onlyOnPaths,
  variant = "site",
}: {
  lead: string;
  tail: string | null;
  /** «Подробнее» — только тем, кто может открыть тариф. */
  href: string | null;
  /** Сегодняшний день по Москве — ключ «скрыть на день». */
  dayKey: string;
  /** Показывать только на этих страницах (главная роли). */
  onlyOnPaths?: string[];
  variant?: "site" | "mini";
}) {
  const pathname = usePathname();
  // До чтения localStorage не рисуем: иначе закрытый сегодня анонс
  // мигал бы на каждом переходе.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === dayKey);
    } catch {
      setDismissed(false);
    }
  }, [dayKey]);

  if (dismissed) return null;
  if (onlyOnPaths && !onlyOnPaths.some((p) => pathname === p)) return null;

  const close = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, dayKey);
    } catch {
      /* приватный режим — скроем до перезагрузки */
    }
  };

  return (
    <div
      role="status"
      data-testid="billing-announcement"
      className={cn(
        "flex items-start gap-3 rounded-2xl border border-[#c7ccea] bg-[#eef1ff] px-4 py-3 text-[13.5px] leading-relaxed text-[#3848c7]",
        variant === "site" ? "mb-4" : "mb-3"
      )}
    >
      <Gift className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="font-medium text-[#0b1024]">{lead}</span>
        {tail ? <span> {tail}</span> : null}
        {href ? (
          <>
            {" "}
            <Link href={href} className="font-medium underline underline-offset-2">
              Подробнее
            </Link>
          </>
        ) : null}
      </div>
      <button
        type="button"
        onClick={close}
        aria-label="Скрыть до завтра"
        title="Скрыть до завтра"
        className="-mr-1 -mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg opacity-70 transition-opacity duration-150 hover:opacity-100"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
