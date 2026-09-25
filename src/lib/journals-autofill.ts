/**
 * Автозаполнение журналов с главной (кнопка «Автозаполнить» в карточке
 * «Обязательные журналы», 2026-09-25). Сам расчёт делает прежний
 * `/api/dashboard/close-day`; здесь — текст шторки и итоговый тост,
 * вынесенные из компонента, чтобы их можно было проверить тестом.
 */

/** Объяснение в шторке — слово в слово из решения владельца. */
export const AUTOFILL_DESCRIPTION =
  "Создадим или дозаполним записи во всех журналах по прошлым данным, если за сегодня их нет. Уже введённые данные не тронем.";

export type AutofillResult = {
  totalFilled: number;
  documentsCreated: number;
  processed: number;
  upToKey: string;
  summaries: Array<{ filled: number }>;
};

function pluralRu(one: string, few: string, many: string) {
  return (count: number) => {
    const abs = Math.abs(count) % 100;
    const lastDigit = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (lastDigit === 1) return one;
    if (lastDigit >= 2 && lastDigit <= 4) return few;
    return many;
  };
}
const markWord = pluralRu("отметка", "отметки", "отметок");
const journalWord = pluralRu("журнал", "журнала", "журналов");
const documentWord = pluralRu("документ", "документа", "документов");

function formatDayRu(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

export type AutofillToast =
  | { kind: "info"; title: string }
  | { kind: "success"; title: string; description: string };

/** Итог автозаполнения: «Заполнено: N журналов, M отметок[, создано K документов]». */
export function autofillToast(result: AutofillResult): AutofillToast {
  if (result.totalFilled === 0 && result.documentsCreated === 0) {
    return {
      kind: "info",
      title:
        result.processed === 0
          ? "Нет ежедневных журналов для заполнения."
          : "Всё уже заполнено — за сегодня пустых записей нет.",
    };
  }
  const touched = result.summaries.filter((s) => s.filled > 0).length;
  const parts = [
    `Заполнено: ${touched} ${journalWord(touched)}, ${result.totalFilled} ${markWord(result.totalFilled)}`,
  ];
  if (result.documentsCreated > 0) {
    parts.push(`создано ${result.documentsCreated} ${documentWord(result.documentsCreated)}`);
  }
  return {
    kind: "success",
    title: parts.join(", "),
    description: `По ${formatDayRu(result.upToKey)}. Данные можно поправить в самих журналах.`,
  };
}
