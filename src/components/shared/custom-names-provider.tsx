"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

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

type ApplyCustomNames = (names: CustomNames) => void;

const ApplyCustomNamesContext = createContext<ApplyCustomNames | null>(null);

function ignoreNames() {}

export function CustomNamesProvider({
  names,
  children,
}: {
  names: CustomNames;
  children: ReactNode;
}) {
  // Названия, только что сохранённые прямо на странице (окно «Своё
  // название журнала»): заголовок, крошки и меню меняются сразу, не
  // дожидаясь, пока `router.refresh()` принесёт свежий layout. Как только
  // сервер прислал новые `names`, снова верим серверу.
  const [saved, setSaved] = useState<{ base: CustomNames; names: CustomNames } | null>(null);
  const value = saved && saved.base === names ? saved.names : names;
  const apply = useCallback<ApplyCustomNames>(
    (next) => setSaved({ base: names, names: next }),
    [names]
  );
  return (
    <ApplyCustomNamesContext.Provider value={apply}>
      <CustomNamesContext.Provider value={value}>{children}</CustomNamesContext.Provider>
    </ApplyCustomNamesContext.Provider>
  );
}

/** Свои названия активной организации (пустые — всё стандартное). */
export function useCustomNames(): CustomNames {
  return useContext(CustomNamesContext);
}

/**
 * Показать только что сохранённый набор названий (ответ API) сразу, до
 * обновления страницы. Без провайдера ничего не делает.
 */
export function useApplyCustomNames(): ApplyCustomNames {
  return useContext(ApplyCustomNamesContext) ?? ignoreNames;
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
 *
 * `titleActions` — кнопки в строку с названием (карандаш «Своё название
 * журнала», переключатель «Включён»): их рисует `JournalHeadingName`
 * сразу после названия, а решает, какие нужны, страница журнала.
 */
type CurrentJournal = { code: string; officialName: string; titleActions?: ReactNode };

const CurrentJournalContext = createContext<CurrentJournal | null>(null);

export function CurrentJournalProvider({
  code,
  officialName,
  titleActions,
  children,
}: CurrentJournal & { children: ReactNode }) {
  const value = useMemo(
    () => ({ code, officialName, titleActions }),
    [code, officialName, titleActions]
  );
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
  return {
    code: current.code,
    officialName: current.officialName,
    customName: customJournalName(names, current.code),
  };
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
 * Кнопки страницы (`titleActions`) встают сразу за названием.
 */
export function JournalHeadingName({
  fallback,
  suffix,
}: {
  fallback: ReactNode;
  suffix?: string | null;
}) {
  const current = useCurrentJournalNames();
  const actions = useContext(CurrentJournalContext)?.titleActions ?? null;
  if (!current?.customName) {
    return (
      <>
        {fallback}
        {actions}
      </>
    );
  }
  return (
    <>
      {current.customName}
      {suffix ?? null}
      {actions}
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
