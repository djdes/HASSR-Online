"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { JournalColumnsConfig } from "@/lib/journal-columns";

/**
 * Значения по умолчанию для диалога «Создание документа» на странице
 * журнала.
 *
 * Страница журнала — это ~40 веток со своими клиентами списка документов,
 * и протаскивать проп через каждую — сорок мест, где он разъедется.
 * Поэтому страница кладёт значения один раз в контекст (внутри общей
 * обёртки `withBanner`), а диалог читает их сам.
 */
export type JournalCreateDefaults = {
  /**
   * Основной ответственный журнала из «Ответственные за журналы». Сервер
   * уже проверил, что это живой сотрудник этой организации; `null` — в
   * настройках никого нет, человек выбирает сам.
   */
  defaultResponsibleUserId: string | null;
  /**
   * Общие наборы колонок организации по кодам журналов. Переключатели
   * колонок в диалоге создания стартуют с них.
   */
  columnDefaults?: Record<string, JournalColumnsConfig>;
  /**
   * В шапке «Выберите объект» (офис или вся организация): документ журнала
   * создаётся для объекта (владелец, 2026-11-23: офис — не объект), окно
   * создания просит выбрать его. `createHref` — «Создать объект» (руководителю).
   */
  point?: { options: Array<{ id: string; name: string }>; createHref: string | null } | null;
};

const JournalCreateDefaultsContext = createContext<JournalCreateDefaults>({
  defaultResponsibleUserId: null,
});

export function JournalCreateDefaultsProvider({
  value,
  children,
}: {
  value: JournalCreateDefaults;
  children: ReactNode;
}) {
  return (
    <JournalCreateDefaultsContext.Provider value={value}>
      {children}
    </JournalCreateDefaultsContext.Provider>
  );
}

export function useJournalCreateDefaults(): JournalCreateDefaults {
  return useContext(JournalCreateDefaultsContext);
}
