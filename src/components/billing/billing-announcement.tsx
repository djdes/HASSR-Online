"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Gift, X } from "lucide-react";

import { PromoPrice } from "@/components/pricing/promo-price";
import type { BillingPrice } from "@/lib/billing-period";
import {
  announcementCookieString,
  BILLING_ANNOUNCEMENT_LEGACY_KEY,
} from "@/lib/billing-announcement-cookie";
import { cn } from "@/lib/utils";

/**
 * Анонс бесплатного периода: «С 1 по 10 октября подписка «до 10
 * сотрудников» бесплатна для всех. С 11 октября — 1 990 ₽/мес или
 * бесплатный тариф на 1 сотрудника». Видят все роли — наверху главной
 * (дашборд руководителя, журналы сотрудника) и в профиле мини-приложения.
 * Закрывается на день: завтра покажется снова, пока идёт период.
 *
 * Тексты считает сервер (`announcementText`): даты — из настроек ROOT,
 * цена — из тарифа с акцией на день перехода (`tailParts`: старая цена
 * зачёркнута). Организациям с оплаченной подпиской не рендерится.
 */
// Решение «показывать сегодня» принимает сервер по куке (billing-view.server):
// закрытый сегодня анонс сюда не приходит, открытый рисуется сразу, без
// сдвига страницы после гидрации.

export function BillingAnnouncement({
  lead,
  tail,
  tailParts = null,
  href,
  dayKey,
  onlyOnPaths,
  variant = "site",
}: {
  lead: string;
  tail: string | null;
  /** `tail` по частям — цена компонентом `PromoPrice`. */
  tailParts?: { before: string; price: BillingPrice; after: string } | null;
  /** «Подробнее» — только тем, кто может открыть тариф. */
  href: string | null;
  /** Сегодняшний день по Москве — ключ «скрыть на день». */
  dayKey: string;
  /** Показывать только на этих страницах (главная роли). */
  onlyOnPaths?: string[];
  variant?: "site" | "mini";
}) {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  // Один раз после выката: прежняя отметка «скрыть до завтра» в localStorage
  // переезжает в куку, чтобы дальше решал сервер.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(BILLING_ANNOUNCEMENT_LEGACY_KEY) === dayKey) {
        document.cookie = announcementCookieString(dayKey);
        setDismissed(true);
      }
      window.localStorage.removeItem(BILLING_ANNOUNCEMENT_LEGACY_KEY);
    } catch {
      /* приватный режим — ничего не переносим */
    }
  }, [dayKey]);

  if (dismissed) return null;
  if (onlyOnPaths && !onlyOnPaths.some((p) => pathname === p)) return null;

  const close = () => {
    setDismissed(true);
    document.cookie = announcementCookieString(dayKey);
    console.info("[billing] announcement dismissed for", dayKey);
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
        {tailParts ? (
          <span>
            {" "}
            {tailParts.before}
            <PromoPrice price={tailParts.price} size="text" tone="inherit" suffix="/мес" />
            {tailParts.after}
          </span>
        ) : tail ? (
          <span> {tail}</span>
        ) : null}
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
