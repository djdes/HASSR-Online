"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import { isNavHrefDenied } from "@/lib/app-nav";
import { SECTION_JUMPS, type SectionJumpKind } from "@/lib/section-jumps";
import { cn } from "@/lib/utils";
import { useAppNav } from "@/components/layout/app-nav-context";

const VARIANTS = {
  /** Ссылка в строке подсказки. */
  link: "rounded-md font-medium text-[#3848c7] underline decoration-[#5566f6]/30 underline-offset-4 hover:text-[#5566f6] hover:decoration-[#5566f6]",
  /** Отдельная кнопка под пустым списком. */
  button:
    "min-h-9 rounded-xl border border-[#dcdfed] bg-white px-3 py-1.5 text-[13px] font-medium text-[#3848c7] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
} as const;

/**
 * Ссылка «в раздел, где это заполняют» — для пустых списков выбора:
 * «В организации пока нет активных сотрудников» → «Добавить сотрудников».
 * Человек не ищет раздел в меню (владелец, 2026-11-19).
 *
 * Адрес и подпись — по виду справочника (`lib/section-jumps.ts`). Если раздел
 * человеку закрыт по роли (`deniedHrefs` модели меню), ссылки нет: вести на
 * «Нет доступа» незачем. `onNavigate` — закрыть окно, в котором стоит ссылка.
 */
export function SectionJump({
  to,
  variant = "link",
  children,
  className,
  onNavigate,
}: {
  to: SectionJumpKind;
  variant?: keyof typeof VARIANTS;
  /** Своя подпись вместо стандартной (например, часть фразы). */
  children?: React.ReactNode;
  className?: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations("sharedUi.sectionJump");
  const { deniedHrefs } = useAppNav();
  const href = SECTION_JUMPS[to];
  if (isNavHrefDenied(href, deniedHrefs)) return null;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      data-section-jump={to}
      className={cn(
        "inline-flex items-center gap-1 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
        VARIANTS[variant],
        className,
      )}
    >
      {children ?? t(to)}
      <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
    </Link>
  );
}

/**
 * Доступен ли раздел человеку — когда ссылку рисует сам текст (`t.rich`) и
 * при закрытом разделе нужен текст без ссылки.
 */
export function useSectionJumpAllowed(to: SectionJumpKind): boolean {
  const { deniedHrefs } = useAppNav();
  return !isNavHrefDenied(SECTION_JUMPS[to], deniedHrefs);
}
