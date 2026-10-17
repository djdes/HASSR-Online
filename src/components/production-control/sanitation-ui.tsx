import type { ReactNode } from "react";
import type { DueState } from "@/lib/ppk/sanitation";

/*
 * Общие куски блоков санитарии (дезинсекция и дератизация, лаборатория):
 * дата со сроком, переключатель «пилюлями» и классы кнопок-сегментов.
 */

/** Сегмент-переключатель (вид, объект): активный — индиго, остальные — рамка. */
export function ppkSegmentClass(active: boolean): string {
  return `inline-flex h-10 items-center rounded-2xl border px-3.5 text-[14px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
    active
      ? "border-[#5566f6] bg-[#f5f6ff] text-[#3848c7]"
      : "border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
  }`;
}

/** Дата в виде «16 окт. 2026»; пустая дата — прочерк. */
export function formatPlanDate(value: string | null, locale: string): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Дата со сроком: просрочено — красно-розовая заливка, скоро — янтарная; у остальных — обычный текст. */
export function DueDate({
  value,
  state,
  locale,
  overdueLabel,
  soonLabel,
}: {
  value: string | null;
  state: DueState;
  locale: string;
  overdueLabel: string;
  soonLabel: string;
}) {
  if (!value) return <span className="text-[#9b9fb3]">—</span>;
  const tone =
    state === "overdue"
      ? "bg-[#fff4f2] text-[#a13a32]"
      : state === "soon"
        ? "bg-[#fff7e6] text-[#8a5a00]"
        : "text-[#3c4053]";
  return (
    <span className={`inline-flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-0.5 tabular-nums ${tone}`}>
      {formatPlanDate(value, locale)}
      {state === "overdue" ? <span className="text-[12px] font-medium">{overdueLabel}</span> : null}
      {state === "soon" ? <span className="text-[12px] font-medium">{soonLabel}</span> : null}
    </span>
  );
}

/** Пилюля с видом или объектом. */
export function PlanPill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7]">
      {children}
    </span>
  );
}
