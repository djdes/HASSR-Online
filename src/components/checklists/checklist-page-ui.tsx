import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Кирпичи страниц раздела «Чек-листы» (Шаблоны, Назначение, Результаты):
 * нумерованная карточка 1-2-3 как на эскизах руководителя, пустое состояние,
 * кнопки и пилюли статуса. Без хуков — годятся серверным и клиентским
 * компонентам.
 */

export const CL_BUTTON_PRIMARY =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-60";

export const CL_BUTTON_OUTLINE =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-60";

export const CL_BUTTON_DANGER =
  "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-2xl border border-[#f3c7c2] bg-[#fff4f2] px-4 text-[14px] font-medium text-[#a13a32] transition-colors duration-150 hover:border-[#e7a59d] hover:bg-[#ffe9e5] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a13a32]/15 disabled:cursor-not-allowed disabled:opacity-60";

export const CL_LINK =
  "inline-flex items-center gap-1 rounded-lg text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

export const CL_INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

export type PillTone = "indigo" | "ok" | "warn" | "danger" | "muted";

const PILL_TONES: Record<PillTone, string> = {
  indigo: "bg-[#eef1ff] text-[#3848c7]",
  ok: "bg-[#ecfdf5] text-[#116b2a]",
  warn: "bg-[#fff8eb] text-[#9a5b00]",
  danger: "bg-[#fff4f2] text-[#a13a32]",
  muted: "bg-[#f3f4f8] text-[#6f7282]",
};

export function Pill({ tone, children, className }: { tone: PillTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-medium tabular-nums", PILL_TONES[tone], className)}>
      {children}
    </span>
  );
}

/** Нумерованная карточка страницы: номер, заголовок, пояснение, справа — действия. */
export function ChecklistCard({
  id,
  number,
  title,
  description,
  aside,
  children,
  className,
}: {
  id: string;
  number?: number;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      data-checklist-card={id}
      className={cn(
        "min-w-0 scroll-mt-24 rounded-3xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-5 md:p-6",
        className,
      )}
    >
      <div className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-2">
        {number ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#5566f6] text-[15px] font-semibold text-white tabular-nums">
            {number}
          </span>
        ) : null}
        <div className="min-w-0 flex-1 basis-[220px]">
          <h2 className="text-[18px] font-semibold leading-snug tracking-[-0.01em] text-[#0b1024]">{title}</h2>
          {description ? <p className="mt-0.5 text-[13.5px] leading-[1.5] text-[#6f7282]">{description}</p> : null}
        </div>
        {aside ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Пустое состояние с подсказкой, что сделать. */
export function ChecklistEmptyState({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-5 py-10 text-center" data-checklist-empty>
      <div className="text-[15px] font-medium text-[#0b1024]">{title}</div>
      {hint ? <p className="mx-auto mt-1.5 max-w-[440px] text-[13px] leading-[1.5] text-[#6f7282]">{hint}</p> : null}
      {children ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{children}</div> : null}
    </div>
  );
}

/** Инициалы для аватара: первые буквы первых двух слов имени. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.slice(0, 1).toUpperCase()).join("") || "?";
}
