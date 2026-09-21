/**
 * «Запись пустая?» — строка документа существует в БД, но человек в неё
 * ничего не вносил.
 *
 * Отдельный модуль без импорта `@prisma/client`: этим хелпером
 * пользуются и серверный рендер PDF, и клиентские таблицы журналов, а
 * тянуть Prisma в браузерный бандл нельзя.
 *
 * ПОЧЕМУ отдельно от `isAutoSeededEntry`: PDF-рендер заранее превращает
 * заготовку `{_autoSeeded:true}` в `{}` (чтобы строка осталась в сетке
 * бланка), и дальше нормализаторы журналов достраивают из `{}` полный
 * объект с дефолтами. У журнала контроля стекла дефолт
 * `damagesDetected:false` означает «осмотрено, повреждений нет» — то
 * есть ПУСТАЯ заготовка печаталась как проведённая проверка. Поэтому
 * «пустая» проверяется по СЫРЫМ данным записи, до нормализации.
 */

/** Служебные ключи, которые сами по себе не являются заполнением. */
const SERVICE_ENTRY_KEYS = new Set(["_autoSeeded"]);

/**
 * Пустой считается запись, у которой нет ни одного значимого ключа:
 * `null`/`undefined`, `{}`, `{_autoSeeded:true}`, а также объект, все
 * пользовательские поля которого — `null`/`undefined`/пустая строка/
 * пустой массив/пустой объект. Сохранённое `false` (снятый флажок) или
 * `0` — осознанный ответ человека, такая запись НЕ пустая.
 */
export function isBlankEntryData(data: unknown): boolean {
  if (data === null || data === undefined) return true;
  if (typeof data !== "object" || Array.isArray(data)) return false;
  return Object.entries(data as Record<string, unknown>).every(
    ([key, value]) => {
      if (SERVICE_ENTRY_KEYS.has(key)) return true;
      if (value === null || value === undefined) return true;
      if (typeof value === "string") return value.trim() === "";
      if (Array.isArray(value)) return value.length === 0;
      if (typeof value === "object") {
        return Object.keys(value as Record<string, unknown>).length === 0;
      }
      return false;
    }
  );
}
