import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Заголовок-строка рабочей страницы кабинета.
 *
 * Заменяет тёмный hero (`bg-[#0b1024]` + blur-blobs + StatPill) везде,
 * кроме хаба `/settings`. Причина: hero занимал ~250px первого экрана и
 * повторял название, которое и так стоит в хлебных крошках `PageNav`.
 * На ежедневных страницах (журналы, смены, проверки) человеку нужен не
 * баннер, а сразу содержимое — поэтому контент начинается с одной
 * строки: что это за экран и что здесь можно сделать.
 *
 * Кнопку «← Назад» сюда не кладём — её даёт глобальный `PageNav`.
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Мелкая надстрочная подпись — раздел/контекст, например «Журнал». */
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // flex-wrap: когда действий много (страница сотрудников — семь
        // кнопок), они переносятся под заголовок, а не сжимают описание
        // в узкий столбец.
        "flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 sm:min-w-[320px] sm:flex-1">
        {eyebrow ? (
          <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024] [text-wrap:balance]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-[720px] text-[14px] leading-[1.55] text-[#6f7282]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        // max-w-full: действий больше, чем влезает в строку (сотрудники —
        // восемь кнопок и пилюль), — они переносятся внутри ширины страницы,
        // а не уезжают за правый край.
        <div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2 sm:ml-auto sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Тихая пилюля для `actions` — то, во что превращаются StatPill'ы из
 * снятых hero. Не кричит цветом: это справка, а не действие.
 */
export function PageHeaderStat({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium tabular-nums",
        tone === "ok"
          ? "bg-[#ecfdf5] text-[#116b2a]"
          : tone === "warn"
            ? "bg-[#fff4f2] text-[#a13a32]"
            : "bg-[#f5f6ff] text-[#3848c7]",
      )}
    >
      {children}
    </span>
  );
}
