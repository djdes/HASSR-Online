"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  customJournalName,
  emptyCustomNames,
  journalDisplayName,
  type CustomNames,
} from "@/lib/custom-names";
import { cn } from "@/lib/utils";

/**
 * Свои названия организации на клиенте — единственный способ их получить.
 *
 * Сервер читает названия один раз в `(dashboard)/layout.tsx`
 * (`getOrgCustomNames`) и кладёт их сюда; меню, крошки, карточки журналов
 * и поиск берут их через хуки ниже, а не запрашивают каждая сама. Без
 * провайдера (публичные страницы) хуки возвращают стандартные названия.
 */

const EMPTY = emptyCustomNames();

const CustomNamesContext = createContext<CustomNames>(EMPTY);

export function CustomNamesProvider({
  names,
  children,
}: {
  names: CustomNames;
  children: ReactNode;
}) {
  return <CustomNamesContext.Provider value={names}>{children}</CustomNamesContext.Provider>;
}

/** Свои названия активной организации (пустые — всё стандартное). */
export function useCustomNames(): CustomNames {
  return useContext(CustomNamesContext);
}

/** Название журнала для человека: своё, если задано, иначе официальное. */
export function useJournalDisplayName(code: string, officialName: string): string {
  return journalDisplayName(useCustomNames(), code, officialName);
}

/**
 * Журнал, который открыт на странице (список документов или документ).
 * Кладёт его сервер страницы — по нему заголовок и строка «Официальное
 * название: …» узнают, о каком журнале речь, без новых пропсов в
 * тридцати клиентах журналов.
 */
type CurrentJournal = { code: string; officialName: string };

const CurrentJournalContext = createContext<CurrentJournal | null>(null);

export function CurrentJournalProvider({
  code,
  officialName,
  children,
}: CurrentJournal & { children: ReactNode }) {
  const value = useMemo(() => ({ code, officialName }), [code, officialName]);
  return <CurrentJournalContext.Provider value={value}>{children}</CurrentJournalContext.Provider>;
}

export type CurrentJournalNames = {
  code: string;
  officialName: string;
  /** Своё название или null — тогда подсказка не нужна. */
  customName: string | null;
};

export function useCurrentJournalNames(): CurrentJournalNames | null {
  const current = useContext(CurrentJournalContext);
  const names = useCustomNames();
  if (!current) return null;
  return { ...current, customName: customJournalName(names, current.code) };
}

const OFFICIAL_HINT_CLASS =
  "text-[13px] font-normal leading-snug tracking-normal text-[#6f7282]";

/**
 * Текст заголовка списка документов журнала. Своё название — вместо
 * стандартного, а под ним мелко «Официальное название: …», чтобы
 * руководитель и проверяющий говорили об одном журнале.
 *
 * `fallback` — ровно то, что заголовок показывал раньше (вместе с
 * «(закрытые)»): без своего названия экран не меняется ни на символ.
 * `suffix` дописывается к своему названию на вкладке закрытых.
 */
export function JournalHeadingName({
  fallback,
  suffix,
}: {
  fallback: ReactNode;
  suffix?: string | null;
}) {
  const current = useCurrentJournalNames();
  if (!current?.customName) return <>{fallback}</>;
  return (
    <>
      {current.customName}
      {suffix ?? null}
      <span className={cn("mt-1 block", OFFICIAL_HINT_CLASS)} data-official-name="">
        Официальное название: {current.officialName}
      </span>
    </>
  );
}

/**
 * Строка под заголовком документа: «Своё · Официальное название: …».
 * Заголовок документа — его собственное название (оно хранится в
 * документе и печатается), поэтому своё название журнала показываем
 * здесь, рядом с официальным. Без своего названия строки нет.
 */
export function JournalOfficialNameNote({ className }: { className?: string }) {
  const current = useCurrentJournalNames();
  if (!current?.customName) return null;
  return (
    <p className={cn("mt-1.5 print:hidden", OFFICIAL_HINT_CLASS, className)} data-official-name="">
      <span className="font-medium text-[#3c4053]">{current.customName}</span>
      {" · "}
      Официальное название: {current.officialName}
    </p>
  );
}
