"use client";
import { useTranslations } from "next-intl";

import { createPortal } from "react-dom";
import { BookOpen } from "lucide-react";

import { useFabAction, useHasFabDock } from "@/components/layout/fab-dock";

/**
 * Круглая 44px кнопка гайда внизу справа. Общая для старого sheet'а с
 * правилами (журналы без walkthrough) и нового окна «Как заполнить?».
 *
 * Q3: кнопка ПОРТАЛИТСЯ в body. Раньше она рендерилась внутри обёртки
 * раздела журналов (`journals/[code]/layout.tsx`), у которой стоит
 * `-translate-x-1/2` — а любой transform создаёт containing block для
 * `position: fixed`. Из-за этого `bottom` отсчитывался не от окна, а от
 * низа всей длинной страницы документа.
 *
 * A13 аудита: правый нижний угол, в один столбик над двумя FAB'ами
 * поддержки и AI-помощника (оба 44px на `bottom-5`): 20 + 44 + 8 = 72px —
 * дефолт `bottomOffset`. В Mini App стопка другая (нижняя навигация +
 * AI-помощник на 96px), поэтому смещение приходит пропом. z-30 — как у
 * поддержки, ниже раскрытой панели поддержки (z-40).
 *
 * R5-15: подпись живёт в tooltip'е слева от кнопки и в поток не
 * попадает — иначе пилюля накрывала правый край широких таблиц.
 */
export function JournalGuideFab({
  onClick,
  label,
  ariaLabel,
  bottomOffset = 72,
}: {
  onClick: () => void;
  label: string;
  ariaLabel?: string;
  bottomOffset?: number;
}) {
  const t = useTranslations("journalControls.guide");
  // В кабинете кнопка живёт в общем доке (`FabDockProvider`): на телефоне
  // три плавающие кнопки закрывали правый край таблицы. В Mini App дока
  // нет — там компонент по-прежнему рисует свою кнопку сам.
  const docked = useHasFabDock();
  useFabAction(
    {
      id: "journal-guide",
      order: 30,
      label,
      hint: t("hint"),
      icon: BookOpen,
      onSelect: onClick,
    },
    docked,
  );

  if (docked) return null;
  if (typeof document === "undefined") return null;
  return createPortal(
    <button
      type="button"
      onClick={onClick}
      style={{ bottom: bottomOffset }}
      className="group fixed right-5 z-30 inline-flex size-11 items-center justify-center rounded-full border border-[#ececf4] bg-white text-[#0b1024] shadow-[0_12px_30px_-10px_rgba(11,16,36,0.25)] transition-all duration-150 hover:scale-105 hover:border-[#5566f6]/40 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 print:hidden"
      aria-label={ariaLabel ?? label}
    >
      <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-[#5566f6] to-[#7a5cff] text-white">
        <BookOpen className="size-4" />
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-[calc(100%+10px)] whitespace-nowrap rounded-lg bg-[#0b1024] px-2.5 py-1.5 text-[12.5px] font-medium text-white opacity-0 shadow-[0_8px_24px_-8px_rgba(11,16,36,0.45)] transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {label}
      </span>
    </button>,
    document.body
  );
}
