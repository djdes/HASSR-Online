/**
 * Чистая логика ХАССП: значимость опасностей, дерево решений для ККТ/ОПП,
 * номера контрольных точек, роли группы и текст политики. Без БД и React.
 */

/** Порог значимости: вероятность × тяжесть ≥ 6 — опасность значимая (ГОСТ Р 51705.1). */
export const PPK_SIGNIFICANCE_THRESHOLD = 6;

export type HazardType = "bio" | "chem" | "phys" | "allergen";

/** Риск опасности: вероятность × тяжесть (оба 1..4). */
export function hazardRisk(probability: number, severity: number): number {
  return probability * severity;
}

/** Значимая опасность: риск не ниже порога. */
export function isSignificantHazard(probability: number, severity: number): boolean {
  return hazardRisk(probability, severity) >= PPK_SIGNIFICANCE_THRESHOLD;
}

export type ControlKind = "ccp" | "oprp" | "prp" | "none";

export type DecisionAnswers = {
  q1: boolean | null;
  q2: boolean | null;
  q3: boolean | null;
  q4: boolean | null;
};

/**
 * Подсказка типа контроля по дереву решений из 4 вопросов:
 * q1 нет → не ККТ («none»); q2 да → ККТ; q3 нет → ПРП; q4 да → ОПП; q4 нет → ККТ.
 * Пока нужного ответа нет — null.
 */
export function decisionSuggestion(a: DecisionAnswers): ControlKind | null {
  if (a.q1 === null) return null;
  if (a.q1 === false) return "none";
  if (a.q2 === null) return null;
  if (a.q2 === true) return "ccp";
  if (a.q3 === null) return null;
  if (a.q3 === false) return "prp";
  if (a.q4 === null) return null;
  return a.q4 ? "oprp" : "ccp";
}

const CONTROL_PREFIX: Record<"ccp" | "oprp", string> = { ccp: "ККТ-", oprp: "ОПП-" };

/** Следующий номер ККТ или ОПП: максимум по своему префиксу + 1. */
export function nextControlNumber(existing: string[], kind: "ccp" | "oprp"): string {
  const prefix = CONTROL_PREFIX[kind];
  let max = 0;
  for (const value of existing) {
    if (!value.startsWith(prefix)) continue;
    const match = /^(\d+)$/.exec(value.slice(prefix.length).trim());
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${max + 1}`;
}

export type TeamRole = "leader" | "deputy" | "member" | "secretary";

export const TEAM_ROLE_DUTIES: Record<TeamRole, string> = {
  leader:
    "Организует работу группы, утверждает план ХАССП, проводит заседания не реже раза в квартал, отвечает за внедрение и поддержание системы.",
  deputy:
    "Замещает руководителя группы, координирует анализ опасностей и определение критических контрольных точек.",
  member:
    "Участвует в описании продукции, построении блок-схем и анализе опасностей на своём участке, контролирует выполнение процедур.",
  secretary:
    "Ведёт протоколы заседаний группы, хранит документацию ХАССП и следит за её актуальностью.",
};

/** Текст политики в области качества и безопасности с названием организации. Абзацы — через пустую строку. */
export function policyTemplate(orgName: string): string {
  const name = orgName.trim() || "организация";
  return [
    `Руководство ${name} обязуется выпускать безопасную продукцию, соответствующую требованиям законодательства и ожиданиям потребителей.`,
    "Мы соблюдаем требования ТР ТС 021/2011 «О безопасности пищевой продукции», СанПиН 2.3/2.4.4282-26 и принципы ХАССП в соответствии с ГОСТ Р 51705.1-2024.",
    "Контроль безопасности осуществляется на всех этапах — от приёмки сырья до раздачи готовой продукции.",
    "Все сотрудники проходят обучение и инструктаж по правилам личной гигиены, производственной санитарии и порядку ведения журналов.",
    "Мы отбираем поставщиков по требованиям к безопасности, проверяем сопроводительные документы и результаты лабораторных исследований.",
    "Жалобы потребителей анализируются, по каждому случаю проводятся корректирующие действия и делаются выводы для предотвращения повторения.",
    "Политика пересматривается ежегодно, а также при изменении законодательства, продукции или технологических процессов.",
    "Настоящая политика доводится до сведения каждого сотрудника под подпись и размещается на видном месте в производстве.",
  ].join("\n\n");
}
