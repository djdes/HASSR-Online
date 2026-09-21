import { Prisma } from "@prisma/client";

/**
 * Service-маркер для авто-сидед entries (см. journal-document-entries-seed.ts).
 * Сидед-записи создаются как структурные плейсхолдеры при создании
 * документа — UI видит их как «строки», но любой compliance/analytics
 * счётчик должен их игнорировать.
 *
 * Если расширишь набор маркеров (`_imported`, `_migrated`...) —
 * добавляй сюда же и обновляй фильтр.
 */
export const SEED_DATA_SHAPE = { _autoSeeded: true } as const;

/**
 * Where-clause фрагмент: «entries без _autoSeeded маркера» = реально
 * заполненные.
 *
 * ВАЖНО про Postgres + JSON path filter: `path: ["_autoSeeded"], equals: true`
 * с обёрткой NOT не работает как ожидается, потому что для записей где
 * ключа нет, `data->'_autoSeeded'` возвращает NULL, `NULL = TRUE` → NULL,
 * и `NOT NULL` тоже NULL — такие строки выпадают из выборки.
 *
 * Поэтому используем equals на ВЕСЬ data: сидед entries имеют РОВНО
 * `{ _autoSeeded: true }`, а реальные записи — другую структуру (даже
 * пустая `{}` от пользователя не совпадёт).
 */
export const NOT_AUTO_SEEDED: Prisma.JournalDocumentEntryWhereInput = {
  NOT: {
    data: {
      equals: SEED_DATA_SHAPE as unknown as Prisma.InputJsonValue,
    },
  },
};

/**
 * Хелпер: проверка in-memory (для случаев когда уже выбрали и нужно
 * отфильтровать в JS). Использует тот же критерий что и DB-фильтр.
 */
export function isAutoSeededEntry(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);
  return keys.length === 1 && obj._autoSeeded === true;
}

/**
 * «Запись пустая?» — реализация живёт в `journal-entry-blank.ts`
 * (без импорта Prisma, чтобы хелпер можно было звать и из браузера).
 */
export { isBlankEntryData } from "@/lib/journal-entry-blank";
