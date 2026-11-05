import { checklistRowKey, fillChecklistRows, prefillChecklistRows, type ChecklistRow } from "./custom-checklist-rows";
import type { ChecklistAnswers, ChecklistDefinition } from "./custom-checklists";
import { isServingTemp, type ServingTemp } from "./product-kinds";

/**
 * Блюда для чек-листа «Контроль температуры готовых блюд на раздаче»
 * (05.11.2026). Источники — по порядку:
 *   1. сегодняшние строки «Журнала бракеража готовой пищевой продукции»:
 *      бракераж проводят до раздачи, значит это блюда, которые выдают сейчас;
 *   2. справочник продуктов с видом «Готовая продукция».
 * Без повторов (регистр и «ё» не различаем), не больше `SERVING_DISHES_LIMIT`.
 * Как подаётся (горячее / первое / холодное) — из карточки справочника.
 */

export const SERVING_DISHES_LIMIT = 60;

export type ServingDish = ChecklistRow & {
  servingTemp: ServingTemp | null;
  source: "brakerage" | "directory";
};

export function mergeServingDishes(input: {
  brakerage: string[];
  directory: Array<{ name: string; servingTemp: string | null }>;
  limit?: number;
}): ServingDish[] {
  const serving = new Map<string, ServingTemp>();
  for (const product of input.directory) {
    if (isServingTemp(product.servingTemp)) serving.set(checklistRowKey(product.name), product.servingTemp);
  }
  const result: ServingDish[] = [];
  const seen = new Set<string>();
  const push = (raw: string, source: ServingDish["source"]) => {
    const title = raw.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!title) return;
    const key = checklistRowKey(title);
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ key, title, servingTemp: serving.get(key) ?? null, source });
  };
  for (const name of input.brakerage) push(name, "brakerage");
  for (const product of input.directory) push(product.name, "directory");
  return result.slice(0, input.limit ?? SERVING_DISHES_LIMIT);
}

/**
 * Блюда — в снимок проверки: строки категорий «блюда на раздаче» и
 * предзаполненный выбор «Как подаётся» по справочнику. Для старта проверки
 * и для «Обновить список блюд» (новые блюда добавляются в конец, ответы
 * по уже имеющимся не трогаем).
 */
export function applyServingDishes(
  definition: ChecklistDefinition,
  dishes: ServingDish[],
  answers: ChecklistAnswers = {},
): { definition: ChecklistDefinition; answers: ChecklistAnswers; added: ServingDish[] } {
  const filled = fillChecklistRows(definition, "serving_dishes", dishes.map(({ key, title }) => ({ key, title })));
  const addedKeys = new Set(filled.added.map((row) => row.key));
  const added = dishes.filter((dish) => addedKeys.has(dish.key));
  return {
    definition: filled.definition,
    answers: prefillChecklistRows(filled.definition, "serving_dishes", added.map((dish) => ({ key: dish.key, optionValue: dish.servingTemp })), answers),
    added,
  };
}
