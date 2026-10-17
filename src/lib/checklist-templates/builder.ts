/**
 * Конструктор типовых шаблонов чек-листов.
 *
 * Шаблоны пишутся как данные: раздел → категория → вопрос. Идентификаторы
 * раздаёт `buildDefinition` по порядку (`<префикс>-s1`, `<префикс>-s1-c1`,
 * `<префикс>-q1`, …) — у организации всё равно лежит независимая копия,
 * поэтому стабильность id между версиями шаблона не нужна, а ручные id
 * в сотнях вопросов — источник дублей.
 *
 * Баллы: вес вопроса (`weight`) — 1 обычный пункт, 2 важный, 3 критичный.
 * Нарушение: у «Да / Нет» ответ «Нет» — нарушение по умолчанию (так считает
 * конструктор), у числа — условие `violation`, у выбора — варианты с
 * `violation`. Критичный пункт дополнительно получает правило логики
 * «критическое нарушение»: комментарий и фото обязательны.
 */
import type { ChecklistCondition } from "@/lib/custom-checklist-rules";
import type { ChecklistDefinition, ChecklistQuestion } from "@/lib/custom-checklists";

export const TYPICAL_CHECKLIST_KEYS = [
  "sanpin",
  "haccp",
  "territorial-manager",
  "chief-technologist",
  "rospotrebnadzor-prep",
  "haccp-audit",
] as const;

export type TypicalChecklistKey = (typeof TYPICAL_CHECKLIST_KEYS)[number];

export type TypicalChecklistTemplate = {
  key: TypicalChecklistKey;
  /** Название шаблона у организации (`ChecklistTemplate.title`, до 200 символов). */
  title: string;
  /** Одна-две фразы для карточки «Добавить типовой шаблон»: кто проверяет и что. */
  summary: string;
  /** Нормативная основа — коротко, без выдуманных номеров пунктов. */
  basis: string;
  definition: ChecklistDefinition;
};

/** Вопрос без id: id раздаёт `buildDefinition`. Логика — без id правил. */
export type QuestionDraft = Omit<ChecklistQuestion, "id" | "logic"> & {
  logic?: Array<Omit<NonNullable<ChecklistQuestion["logic"]>[number], "id">>;
};
export type CategoryDraft = { title: string; repeatable?: boolean; questions: QuestionDraft[] };
export type SectionDraft = { title: string; categories: CategoryDraft[] };

type Common = {
  /** Пояснение под вопросом: норма, на что смотреть, как проверить. */
  description?: string;
  /** 1 — обычный, 2 — важный, 3 — критичный пункт. По умолчанию 1 (3 у критичных). */
  weight?: number;
  required?: boolean;
};

type CriticalFlag = {
  /** Критичный пункт: нарушение — критическое, нужны комментарий и фото. */
  critical?: boolean;
};

const CRITICAL_ACTIONS = { critical: true, comment: true, photos: 1 } as const;

function base(title: string, type: ChecklistQuestion["type"], opts: Common, defaults: Partial<QuestionDraft> = {}): QuestionDraft {
  return {
    title,
    description: opts.description ?? "",
    type,
    active: true,
    required: opts.required ?? true,
    weight: opts.weight ?? 1,
    min: 0,
    max: 10,
    options: [],
    ...defaults,
  };
}

/**
 * «Да / Нет / Не применимо». Формулируйте так, чтобы «Да» было нормой:
 * «Нет» конструктор считает нарушением. `na: false` убирает «Не применимо»
 * там, где пункт применим всегда.
 */
export function yesNo(title: string, opts: Common & CriticalFlag & { na?: boolean } = {}): QuestionDraft {
  const question = base(title, "yes_no", { ...opts, weight: opts.weight ?? (opts.critical ? 3 : 1) });
  if (opts.na === false) question.labels = { yes: "Да", no: "Нет", na: "" };
  if (opts.critical) question.logic = [{ condition: { operator: "eq", value: "no" }, actions: { ...CRITICAL_ACTIONS } }];
  return question;
}

export type ChoiceOptionDraft = {
  label: string;
  /** Доля балла за вариант, 0..1. По умолчанию 1. */
  score?: number;
  violation?: boolean;
  /** Вариант — критическое нарушение (требует `violation`). */
  critical?: boolean;
  /** Вариант не участвует в подсчёте баллов («Не применимо»). */
  excluded?: boolean;
};

function optionValues(options: ChoiceOptionDraft[]) {
  return options.map((option, index) => ({
    value: `v${index + 1}`,
    label: option.label,
    score: option.score ?? 1,
    ...(option.violation ? { violation: true } : {}),
    ...(option.excluded ? { excluded: true } : {}),
  }));
}

/** Выбор одного варианта. Варианты-нарушения помечайте `violation`. */
export function choice(title: string, options: ChoiceOptionDraft[], opts: Common = {}): QuestionDraft {
  const values = optionValues(options);
  const critical = options.flatMap((option, index) => (option.critical ? [values[index].value] : []));
  const hasCritical = critical.length > 0;
  return {
    ...base(title, "choice", { ...opts, weight: opts.weight ?? (hasCritical ? 3 : 1) }),
    options: values,
    ...(hasCritical
      ? { logic: critical.map((value) => ({ condition: { operator: "eq" as const, value }, actions: { ...CRITICAL_ACTIONS } })) }
      : {}),
  };
}

/** Несколько вариантов. Балл — среднее выбранных; нарушения — варианты с `violation`. */
export function multi(title: string, options: ChoiceOptionDraft[], opts: Common = {}): QuestionDraft {
  return { ...base(title, "multi", opts), options: optionValues(options) };
}

/** Шкала (по умолчанию 1–5). Балл пропорционален оценке. */
export function scale(title: string, opts: Common & { min?: number; max?: number } = {}): QuestionDraft {
  return { ...base(title, "scale", opts), min: opts.min ?? 1, max: opts.max ?? 5, step: 1, scaleScoring: "range" };
}

/**
 * Измерение. `violation` — условие нарушения (например, вне диапазона
 * `{ operator: "not_between", value: 2, upper: 6 }`); `critical` делает
 * его критическим.
 */
export function number(
  title: string,
  opts: Common & CriticalFlag & { min: number; max: number; step?: number; unit?: string; violation: ChecklistCondition },
): QuestionDraft {
  return {
    ...base(title, "number", { ...opts, weight: opts.weight ?? (opts.critical ? 3 : 1) }),
    min: opts.min,
    max: opts.max,
    ...(opts.step ? { step: opts.step } : {}),
    ...(opts.unit ? { unit: opts.unit } : {}),
    violation: opts.violation,
    ...(opts.critical ? { logic: [{ condition: opts.violation, actions: { critical: true, comment: true } }] } : {}),
  };
}

/** Отметка «сделано»: не отмечено — нарушение. */
export function checkbox(title: string, opts: Common = {}): QuestionDraft {
  return base(title, "checkbox", opts);
}

export function datetime(title: string, opts: Common = {}): QuestionDraft {
  return base(title, "datetime", { weight: 0, ...opts });
}

export function text(title: string, opts: Common = {}): QuestionDraft {
  return base(title, "text", { required: false, weight: 0, ...opts });
}

export function photo(title: string, opts: Common & { minPhotos?: number } = {}): QuestionDraft {
  return { ...base(title, "photo", { required: false, weight: 0, ...opts }), ...(opts.minPhotos ? { minPhotos: opts.minPhotos } : {}) };
}

/** Текст-инструкция без ответа. */
export function info(title: string, description: string): QuestionDraft {
  return base(title, "info", { description, required: false, weight: 0 });
}

export function signature(title: string, opts: Common = {}): QuestionDraft {
  return base(title, "signature", { weight: 0, ...opts });
}

export function category(title: string, questions: QuestionDraft[], opts: { repeatable?: boolean } = {}): CategoryDraft {
  return { title, questions, ...(opts.repeatable ? { repeatable: true } : {}) };
}

export function section(title: string, categories: CategoryDraft[]): SectionDraft {
  return { title, categories };
}

/** Собирает определение конструктора и раздаёт id по порядку. */
export function buildDefinition(prefix: string, description: string, sections: SectionDraft[]): ChecklistDefinition {
  let questionIndex = 0;
  return {
    description,
    numbering: true,
    sections: sections.map((sectionDraft, sectionIndex) => {
      const sectionId = `${prefix}-s${sectionIndex + 1}`;
      return {
        id: sectionId,
        title: sectionDraft.title,
        active: true,
        categories: sectionDraft.categories.map((categoryDraft, categoryIndex) => ({
          id: `${sectionId}-c${categoryIndex + 1}`,
          title: categoryDraft.title,
          active: true,
          ...(categoryDraft.repeatable ? { repeatable: true } : {}),
          questions: categoryDraft.questions.map((draft) => {
            questionIndex += 1;
            const id = `${prefix}-q${questionIndex}`;
            const { logic, ...rest } = draft;
            return {
              ...rest,
              id,
              ...(logic?.length ? { logic: logic.map((rule, ruleIndex) => ({ ...rule, id: `${id}-r${ruleIndex + 1}` })) } : {}),
            };
          }),
        })),
      };
    }),
  };
}
