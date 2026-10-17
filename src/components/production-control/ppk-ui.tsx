"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Plus } from "lucide-react";

/*
 * Общие куски интерфейса блоков ХАССП (описание продукции, анализ опасностей):
 * классы полей и кнопок по дизайн-системе, пустое состояние и кнопка «Добавить»
 * в серверной шапке блока.
 */

export const PPK_FIELD_CLASS =
  "h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

export const PPK_TEXTAREA_CLASS =
  "w-full min-h-[96px] resize-y rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[15px] leading-[1.55] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

export const PPK_SELECT_CLASS =
  "h-12 w-full rounded-2xl border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] hover:border-[#5566f6]/40 focus-visible:border-[#5566f6] focus-visible:ring-[#5566f6]/15";

export const PPK_LABEL_CLASS = "mb-1.5 block text-[13px] font-medium text-[#3c4053]";

export const PPK_BUTTON_PRIMARY_CLASS =
  "inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:pointer-events-none disabled:opacity-50";

export const PPK_BUTTON_OUTLINE_CLASS =
  "inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:pointer-events-none disabled:opacity-50";

export const PPK_BUTTON_TEXT_CLASS =
  "inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

export const PPK_BUTTON_TEXT_DANGER_CLASS =
  "inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[13.5px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#fff4f2] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a13a32]/15";

export const PPK_ICON_BUTTON_CLASS =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-[#6f7282] transition-colors duration-150 hover:bg-[#fff4f2] hover:text-[#a13a32] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a13a32]/15 disabled:pointer-events-none disabled:opacity-40";

type PpkActions = { openCreate: () => void };

const PpkActionsContext = createContext<PpkActions | null>(null);

/**
 * Оболочка клиентского блока. Шапка блока отрисована на сервере, но её кнопка
 * «Добавить» должна открывать окно клиента, — поэтому открытие передаётся через
 * контекст: `PpkCreateButton` внутри провайдера достаёт `openCreate`.
 */
export function PpkBlockActionProvider({
  openCreate,
  children,
}: {
  openCreate: () => void;
  children: ReactNode;
}) {
  return (
    <PpkActionsContext.Provider value={{ openCreate }}>{children}</PpkActionsContext.Provider>
  );
}

/** Основная кнопка «Добавить …» для шапки блока. Вне провайдера тихо не работает. */
export function PpkCreateButton({ label }: { label: string }) {
  const actions = useContext(PpkActionsContext);
  return (
    <button
      type="button"
      onClick={() => actions?.openCreate()}
      className={PPK_BUTTON_PRIMARY_CLASS}
    >
      <Plus className="size-4" />
      {label}
    </button>
  );
}

/** Пустое состояние блока: заголовок, подсказка и кнопки-действия. */
export function PpkEmptyState({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
      <div className="text-[15px] font-medium text-[#0b1024]">{title}</div>
      <p className="mx-auto mt-1.5 max-w-[360px] text-[13px] text-[#6f7282]">{hint}</p>
      {children ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}
