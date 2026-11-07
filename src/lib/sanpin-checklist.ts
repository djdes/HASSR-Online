/**
 * Самопроверка «Готовы ли вы к проверке» на /sanpin-2-3-2-4-4282-26
 * (2026-11-07). Шесть вопросов — по журналам каталога WeSetup с основанием
 * СанПиН 2.3/2.4.4282-26 (`journal-info.ts`), седьмой — показать журналы за
 * любой период («Пришла проверка»). Только то, что есть в репозитории: без
 * штрафов и «обязательно»; тест `sanpin-checklist.test.ts` сверяет коды с
 * каталогом.
 */

export type SanpinChecklistItem = {
  id: string;
  /** Журнал каталога; null — вопрос не про журнал, а про выгрузку к проверке. */
  journalCode: string | null;
  question: string;
  /** Что добавить, если ответ «нет» (для журнала — рядом название и описание из каталога). */
  gap: string;
};

export const SANPIN_CHECKLIST: readonly SanpinChecklistItem[] = [
  {
    id: "hygiene",
    journalCode: "hygiene",
    question: "Перед сменой каждого сотрудника осматривают и отмечают это в гигиеническом журнале?",
    gap: "Осмотр сотрудников перед сменой с отметкой в журнале.",
  },
  {
    id: "cold",
    journalCode: "cold_equipment_control",
    question: "Температуру в холодильниках и морозильниках записывают каждый день?",
    gap: "Ежедневные показания температуры холодильного и морозильного оборудования.",
  },
  {
    id: "incoming",
    journalCode: "incoming_control",
    question: "Продукты при приёмке проверяют и записывают в журнал входного контроля?",
    gap: "Запись о приёмке каждой поставки: продукт, документы, температура, решение.",
  },
  {
    id: "finished",
    journalCode: "finished_product",
    question: "Готовые блюда проходят бракераж до раздачи, и результат записан?",
    gap: "Бракераж готовых блюд до раздачи с записью результата.",
  },
  {
    id: "cleaning",
    journalCode: "cleaning",
    question: "Уборку и санитарную обработку отмечают в журнале?",
    gap: "Отметки об уборке и санитарной обработке помещений.",
  },
  {
    id: "disinfectant",
    journalCode: "disinfectant_usage",
    question: "Расход моющих и дезинфицирующих средств учитывают в журнале?",
    gap: "Учёт моющих и дезинфицирующих средств.",
  },
  {
    id: "inspection",
    journalCode: null,
    question: "Если проверка придёт сегодня, сможете за несколько минут показать журналы за любой период?",
    gap: "Журналы за любой период — одним архивом или PDF, как в разделе «Пришла проверка».",
  },
];

export type ChecklistAnswer = "yes" | "no";
export type ChecklistAnswers = Partial<Record<string, ChecklistAnswer>>;

export type ChecklistResult = {
  answered: number;
  total: number;
  /** Ответы «да». */
  score: number;
  /** Все вопросы отвечены — показываем итог. */
  complete: boolean;
  /** Вопросы с ответом «нет», в порядке чек-листа. */
  gaps: SanpinChecklistItem[];
};

export function checklistResult(answers: ChecklistAnswers, items: readonly SanpinChecklistItem[] = SANPIN_CHECKLIST): ChecklistResult {
  const answered = items.filter((item) => answers[item.id] === "yes" || answers[item.id] === "no").length;
  const score = items.filter((item) => answers[item.id] === "yes").length;
  return {
    answered,
    total: items.length,
    score,
    complete: answered === items.length,
    gaps: items.filter((item) => answers[item.id] === "no"),
  };
}

/** Заголовок итога: все закрыто — одна фраза, иначе «закрыто N из 7». */
export function checklistVerdict(result: ChecklistResult): string {
  if (result.score === result.total) return `Все ${result.total} пунктов закрыты`;
  return `Закрыто ${result.score} из ${result.total}`;
}

/**
 * Текст в «Что важно показать» окна записи на показ: менеджер сразу видит,
 * какие журналы человек хочет закрыть. До 500 символов (лимит поля).
 */
export function checklistDemoTopic(result: ChecklistResult, journalNames: Readonly<Record<string, string>>): string {
  const head = `Чек-лист СанПиН: ${result.score} из ${result.total}.`;
  if (result.gaps.length === 0) return `${head} Хочу перевести журналы в электронный вид.`;
  const gaps = result.gaps.map((item) => (item.journalCode ? journalNames[item.journalCode] ?? item.journalCode : "показать журналы за период"));
  return `${head} Не закрыто: ${gaps.join(", ")}.`.slice(0, 500);
}
