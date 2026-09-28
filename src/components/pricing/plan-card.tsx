import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, Gift, Users } from "lucide-react";

import { PromoPrice } from "@/components/pricing/promo-price";
import type { PriceWithPromotion } from "@/lib/promo/promotions";
import { cn } from "@/lib/utils";

/**
 * Карточка тарифа — одна на лендинг и на кабинет.
 *
 * Раньше витрин было две: серверная на лендинге и своя, светлая, в
 * настройках. Они разъезжались при каждой правке — цена на лендинге
 * бралась из БД, а в кабинете была вшита строкой. Теперь вёрстка одна,
 * тексты из `plan-catalog.ts`, цена приходит пропсом.
 *
 * Компонент намеренно БЕЗ "use client" и без состояния: так он остаётся
 * серверным на лендинге и просто попадает в клиентский бандл, когда его
 * импортирует клиентский `PlanUpgrade`. Любой хук здесь сломал бы это.
 */
export function PlanCard({
  kind,
  name,
  from,
  period,
  pointsIntro,
  points,
  ctaLabel,
  ctaHref,
  highlighted,
  badge,
  note,
  ctaDisabled,
  touch = false,
  price,
}: {
  kind: "free" | "team" | "network";
  name: string;
  from: string;
  period: string;
  /// Цена с акцией (lib/promo). Идёт акция — старая цена зачёркнута,
  /// рядом новая и плашка «−N % до …»; нет — показываем `from`.
  price?: PriceWithPromotion;
  /// Подводка над списком — «Всё из Бесплатного, плюс:». Нужна, чтобы
  /// не дублировать в платном тарифе половину бесплатного.
  pointsIntro?: string;
  points: string[];
  ctaLabel: string;
  ctaHref: string;
  highlighted?: boolean;
  badge?: string;
  /// Мелкая строка под кнопкой — условие тарифа (у бесплатного:
  /// «до N сотрудников, без ограничений по записям»).
  note?: string;
  /// Кнопка неактивна: тариф уже действует у этого человека.
  ctaDisabled?: boolean;
  /// Крупнее на телефоне: текст от 16 px, кнопка 48 px (главная,
  /// спека landing-pack-2026-09). С sm и без флага — как было, поэтому
  /// кабинет (/settings/subscription) не меняется.
  touch?: boolean;
}) {
  const Icon =
    kind === "free" ? Gift : kind === "network" ? Building2 : Users;
  return (
    <div
      className={
        highlighted
          ? "relative flex h-full flex-col overflow-hidden rounded-3xl bg-[#0b1024] p-5 text-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.55)] sm:p-8"
          : "relative flex h-full flex-col rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-8"
      }
    >
      {highlighted && (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -right-16 -top-16 size-[260px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
          <div className="absolute -left-16 -bottom-10 size-[240px] rounded-full bg-[#7a5cff] opacity-30 blur-[120px]" />
        </div>
      )}
      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-center gap-3">
          <span
            className={
              highlighted
                ? "flex size-11 items-center justify-center rounded-2xl bg-white/10 text-white ring-1 ring-white/20"
                : "flex size-11 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]"
            }
          >
            <Icon className="size-5" />
          </span>
          <div className="text-[20px] font-semibold tracking-[-0.01em]">
            {name}
          </div>
          {badge && (
            <span
              data-fine-print="badge"
              className="ml-auto inline-flex items-center gap-1 rounded-full bg-[#7cf5c0]/20 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-[#7cf5c0]"
            >
              {badge}
            </span>
          )}
        </div>
        {price?.promotion ? (
          <PromoPrice
            price={price}
            size="xl"
            layout="stacked"
            tone={highlighted ? "dark" : "light"}
            className="mt-5"
            suffix={
              <span
                className={cn(
                  "ml-2",
                  touch ? "text-[16px] sm:text-[13px]" : "text-[13px]",
                  highlighted ? "text-white/60" : "text-[#9b9fb3]",
                )}
              >
                {period}
              </span>
            }
          />
        ) : (
          <div className="mt-6 flex items-baseline gap-2">
            <span className="text-[34px] font-semibold tracking-[-0.02em]">
              {from}
            </span>
            <span
              className={cn(
                touch ? "text-[16px] sm:text-[13px]" : "text-[13px]",
                highlighted ? "text-white/60" : "text-[#9b9fb3]",
              )}
            >
              {period}
            </span>
          </div>
        )}
        {pointsIntro ? (
          <div
            className={cn(
              "mt-6 font-medium",
              touch ? "text-[16px] sm:text-[13px]" : "text-[13px]",
              highlighted ? "text-white/60" : "text-[#9b9fb3]",
            )}
          >
            {pointsIntro}
          </div>
        ) : null}
        <ul
          className={cn(
            "flex-1 space-y-2.5 pb-8",
            touch ? "text-[16px] sm:text-[14px]" : "text-[14px]",
            highlighted ? "mt-3 text-white/85" : "mt-6 text-[#3c4053]",
          )}
        >
          {points.map((p) => (
            <li key={p} className="flex items-start gap-2">
              <CheckCircle2
                className={
                  highlighted
                    ? "mt-0.5 size-4 shrink-0 text-[#7cf5c0]"
                    : "mt-0.5 size-4 shrink-0 text-[#5566f6]"
                }
              />
              <span>{p}</span>
            </li>
          ))}
        </ul>
        {/* Условие над кнопкой, а не под ней: человек читает его ДО
            того, как нажать, а не после. */}
        {note ? (
          <div
            className={cn(
              "mt-auto mb-2.5 text-center",
              touch ? "text-[16px] sm:text-[12px]" : "text-[12px]",
              // После размера: tailwind-merge снимает leading-*, если
              // text-[размер] идёт позже.
              "leading-snug",
              highlighted ? "text-white/70" : "text-[#6f7282]",
            )}
          >
            {note}
          </div>
        ) : null}
        {ctaDisabled ? (
          <span
            aria-disabled="true"
            className={cn(
              "inline-flex w-full cursor-default items-center justify-center gap-2 rounded-2xl border border-[#c7ccea] bg-[#eef1ff] font-medium text-[#3848c7]",
              touch ? "h-12 text-[16px] sm:h-11 sm:text-[15px]" : "h-11 text-[15px]",
            )}
          >
            {ctaLabel}
          </span>
        ) : (
          <Link
            href={ctaHref}
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-2xl font-medium transition-colors",
              touch ? "h-12 text-[16px] sm:h-11 sm:text-[15px]" : "h-11 text-[15px]",
              highlighted
                ? "bg-white text-[#0b1024] hover:bg-white/90"
                : "bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]",
            )}
          >
            {ctaLabel}
            <ArrowRight className="size-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
