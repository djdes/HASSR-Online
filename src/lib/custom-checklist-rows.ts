import type { ChecklistAnswers, ChecklistDefinition, ChecklistQuestion, ChecklistRowSource } from "./custom-checklists";

/**
 * Категории чек-листа со строками из данных (05.11.2026).
 *
 * В шаблоне категория с `rowsSource` — образец карточки: «Как подаётся
 * блюдо», «в начале раздачи», «через час». При старте проверки сервер
 * кладёт в снимок список строк (`rows`: ключ + название блюда), а здесь
 * категория разворачивается в карточку на каждую строку — так же, как
 * повторяемые категории разворачиваются по экземплярам. Проверка ответов,
 * баллы, нарушения, PDF и файлы дальше работают с обычными вопросами.
 *
 * Без `rows` (шаблон в конструкторе) категория остаётся образцом; `rows: []`
 * (проверка, а блюд нет) — карточка-подсказка, откуда взять строки.
 */

export const CHECKLIST_ROW_SEPARATOR = "~";

export type ChecklistRow = { key: string; title: string };

const EMPTY_STATE: Record<ChecklistRowSource, { title: string; description: string }> = {
  serving_dishes: {
    title: "Блюд для замера пока нет",
    description:
      "Список блюд берётся из двух мест: справочник продуктов с видом «Готовая продукция» (Настройки → Справочник продуктов) и сегодняшние записи «Журнала бракеража готовой пищевой продукции». Добавьте блюда в справочник или проведите бракераж, затем нажмите «Обновить список блюд» вверху проверки.",
  },
};

export function checklistRowEmptyState(source: ChecklistRowSource) {
  return EMPTY_STATE[source];
}

export function checklistRowQuestionId(questionId: string, rowKey: string): string {
  return `${questionId}${CHECKLIST_ROW_SEPARATOR}${rowKey}`;
}

/** Ключ строки по названию: регистр, «ё» и лишние пробелы не различаем. */
export function checklistRowKey(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim().toLocaleLowerCase("ru").replace(/ё/g, "е");
  // FNV-1a, 32 бита: ключ короткий и одинаковый для одного блюда в любой день.
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index++) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `r${hash.toString(36)}`;
}

function rowQuestion(question: ChecklistQuestion, row: ChecklistRow, ids: Set<string>): ChecklistQuestion {
  return {
    ...question,
    id: checklistRowQuestionId(question.id, row.key),
    // Название блюда в вопросе: так нарушение понятно и в списке результатов, и в PDF.
    title: `${row.title} — ${question.title}`.slice(0, 300),
    ...(question.showIf
      ? { showIf: { ...question.showIf, questionId: ids.has(question.showIf.questionId) ? checklistRowQuestionId(question.showIf.questionId, row.key) : question.showIf.questionId } }
      : {}),
  };
}

export function expandChecklistRows(definition: ChecklistDefinition): ChecklistDefinition {
  if (!definition.sections.some((section) => section.categories.some((category) => category.rowsSource && category.rows))) return definition;
  return {
    ...definition,
    sections: definition.sections.map((section) => ({
      ...section,
      categories: section.categories.flatMap((category) => {
        if (!category.rowsSource || !category.rows) return [category];
        const { rows, rowsSource, ...rest } = category;
        if (rows.length === 0) {
          const empty = EMPTY_STATE[rowsSource];
          const info: ChecklistQuestion = {
            id: checklistRowQuestionId(category.id, "empty"), title: empty.title, description: empty.description,
            type: "info", active: true, required: false, weight: 0, min: 0, max: 10, options: [],
          };
          return [{ ...rest, questions: [info] }];
        }
        const ids = new Set(category.questions.map((question) => question.id));
        return rows.map((row) => ({
          ...rest,
          id: checklistRowQuestionId(category.id, row.key),
          title: row.title,
          questions: category.questions.map((question) => rowQuestion(question, row, ids)),
        }));
      }),
    })),
  };
}

export function hasChecklistRowSource(definition: ChecklistDefinition, source?: ChecklistRowSource): boolean {
  return definition.sections.some((section) => section.categories.some((category) => category.rowsSource && (!source || category.rowsSource === source)));
}

/**
 * Строки в снимок: к уже имеющимся (если проверку обновляют) — новые по
 * порядку, без повторов, не больше `limit` на категорию.
 */
export function fillChecklistRows(
  definition: ChecklistDefinition,
  source: ChecklistRowSource,
  rows: ChecklistRow[],
  limit = 100,
): { definition: ChecklistDefinition; added: ChecklistRow[] } {
  const added: ChecklistRow[] = [];
  const next: ChecklistDefinition = {
    ...definition,
    sections: definition.sections.map((section) => ({
      ...section,
      categories: section.categories.map((category) => {
        if (category.rowsSource !== source) return category;
        const current = category.rows ?? [];
        const known = new Set(current.map((row) => row.key));
        const merged = [...current];
        for (const row of rows) {
          if (merged.length >= limit) break;
          if (known.has(row.key)) continue;
          known.add(row.key);
          merged.push(row);
          if (!added.some((item) => item.key === row.key)) added.push(row);
        }
        return { ...category, rows: merged };
      }),
    })),
  };
  return { definition: next, added };
}

/**
 * Предзаполнение выбора в строке: в категории-образце берём первый вопрос
 * «Выбор из списка», у которого есть вариант `optionValue`, и ставим его
 * ответом строки, если ответа ещё нет. Так «Как подаётся блюдо» приходит
 * готовым из справочника, а сотрудник только вводит температуру.
 */
export function prefillChecklistRows(
  definition: ChecklistDefinition,
  source: ChecklistRowSource,
  values: Array<{ key: string; optionValue: string | null }>,
  answers: ChecklistAnswers,
): ChecklistAnswers {
  const next: ChecklistAnswers = { ...answers };
  for (const section of definition.sections) {
    for (const category of section.categories) {
      if (category.rowsSource !== source) continue;
      const rowKeys = new Set((category.rows ?? []).map((row) => row.key));
      for (const { key, optionValue } of values) {
        if (!optionValue || !rowKeys.has(key)) continue;
        const question = category.questions.find((item) => item.type === "choice" && item.options.some((option) => option.value === optionValue));
        if (!question) continue;
        const id = checklistRowQuestionId(question.id, key);
        if (next[id] === undefined) next[id] = optionValue;
      }
    }
  }
  return next;
}
