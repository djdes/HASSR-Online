/**
 * Сохранение графика генуборок целым конфигом (PATCH) не должно стирать
 * отметки, которые пришли из задач TasksFlow / QR, пока страница была
 * открыта.
 *
 * Экран держит конфиг, загруженный при открытии. Сотрудник закрыл задачу
 * «Генеральная уборка · Кухня · 11.09» — адаптер под блокировкой
 * документа отметил 11.09 выполненной. Если потом руководитель
 * переименует строку или поменяет ответственного, PATCH принесёт
 * старый конфиг без этой отметки. Слияние под той же блокировкой
 * возвращает отметки с `doneSource: "task"` (и такие же внеплановые
 * уборки), которых нет во входящем конфиге. Ручные отметки не
 * возвращаем: их снимают и ставят с этого же экрана, и «воскресить»
 * снятую — хуже, чем потерять чужую ручную правку в устаревшей вкладке.
 *
 * Функция чистая; вызывается в PATCH `/api/journal-documents/[id]`
 * внутри `withDocumentConfigLock`.
 */
import {
  normalizeSanitationDayConfig,
  reprojectSanitationRow,
  sanitationCleaningId,
  type SanitationCleaning,
  type SanitationDayConfig,
} from "@/lib/sanitation-day-document";

function restoreTaskMarks(
  incoming: ReadonlyArray<SanitationCleaning>,
  current: ReadonlyArray<SanitationCleaning>,
): SanitationCleaning[] {
  const next = incoming.map((c) => ({ ...c }));
  for (const mark of current) {
    if (!mark.done || mark.doneSource !== "task") continue;
    if (mark.planned) {
      const index = next.findIndex((c) => c.planned === mark.planned);
      if (index < 0) {
        next.push({ ...mark });
        continue;
      }
      if (!next[index].done) {
        next[index] = {
          id: sanitationCleaningId(mark.planned, mark.done),
          planned: mark.planned,
          done: mark.done,
          ...(mark.doneBy ? { doneBy: mark.doneBy } : {}),
          doneSource: "task",
        };
      }
      continue;
    }
    if (next.some((c) => c.done === mark.done)) continue;
    const sameDay = next.findIndex((c) => c.planned === mark.done && !c.done);
    if (sameDay >= 0) {
      next[sameDay] = {
        id: sanitationCleaningId(mark.done, mark.done),
        planned: mark.done,
        done: mark.done,
        ...(mark.doneBy ? { doneBy: mark.doneBy } : {}),
        doneSource: "task",
      };
      continue;
    }
    next.push({ ...mark });
  }
  return next;
}

/**
 * Входящий конфиг с возвращёнными отметками задач. Прочие ключи
 * входящего конфига (шапка бланка, `closedAt`) сохраняются как есть —
 * нормализатор знает только поля графика.
 */
export function mergeSanitationTaskMarks(args: {
  incoming: unknown;
  current: unknown;
}): SanitationDayConfig {
  const extras =
    args.incoming && typeof args.incoming === "object" && !Array.isArray(args.incoming)
      ? (args.incoming as Record<string, unknown>)
      : {};
  const incoming = normalizeSanitationDayConfig(args.incoming);
  const current = normalizeSanitationDayConfig(args.current);
  // Смена года — осознанное действие руководителя (перенос дат), старый
  // год сюда не подмешиваем.
  if (incoming.year !== current.year) return { ...extras, ...incoming } as SanitationDayConfig;
  const currentById = new Map(current.rows.map((row) => [row.id, row]));
  const merged = normalizeSanitationDayConfig({
    ...incoming,
    rows: incoming.rows.map((row) => {
      const was = currentById.get(row.id);
      if (!was) return row;
      const cleanings = restoreTaskMarks(row.cleanings, was.cleanings);
      return cleanings.length === row.cleanings.length &&
        cleanings.every((c, i) => JSON.stringify(c) === JSON.stringify(row.cleanings[i]))
        ? row
        : reprojectSanitationRow({ ...row, cleanings }, incoming.year);
    }),
  });
  return { ...extras, ...merged } as SanitationDayConfig;
}
