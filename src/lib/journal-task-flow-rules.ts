/**
 * Правила взятия задач по режиму распределения организации
 * (`Organization.taskFlowMode`, экран /settings/journal-flow).
 *
 * Чистые функции без Prisma — их зовут и сервер (claim API), и экраны
 * приложения («Взять» / «Назначает руководитель»).
 *
 *   race   — «Гонка»: сотрудник берёт сам, у каждого одна активная задача.
 *   shared — «Свободно»: берёт кто хочет; правило «одна задача за раз»
 *            отключено (так режим описан на экране настройки).
 *   manual — «Только руководитель назначает»: сотрудник сам не берёт,
 *            задачу ему назначает руководитель
 *            (POST /api/journal-task-claims/assign).
 *
 * Раньше режим влиял только на правило «одна активная»: в `manual`
 * сотрудник спокойно брал задачи сам, причём сколько угодно.
 */

export type TaskFlowMode = "race" | "shared" | "manual";

export const MANUAL_MODE_CLAIM_MESSAGE =
  "В вашей компании задачи назначает руководитель. Дождитесь назначения";

export function normalizeTaskFlowMode(value: unknown): TaskFlowMode {
  return value === "shared" || value === "manual" ? value : "race";
}

export type ClaimDecision =
  | { allowed: false; reason: "manual_mode" }
  | { allowed: true; enforceOneActive: boolean };

/**
 * Можно ли взять задачу и действует ли правило «одна активная задача».
 *
 * @param assignedByManager — задачу назначает руководитель другому
 *   сотруднику (assign-API). Разрешено в любом режиме, правило «одна
 *   активная» не проверяется — руководитель осознанно даёт вторую.
 * @param actorCanAssign — у того, кто берёт, есть право назначать
 *   (руководитель, ROOT). В `manual` он может взять задачу и себе.
 */
export function decideClaim(args: {
  mode: TaskFlowMode;
  assignedByManager?: boolean;
  actorCanAssign?: boolean;
}): ClaimDecision {
  if (args.assignedByManager) return { allowed: true, enforceOneActive: false };
  if (args.mode === "manual" && !args.actorCanAssign) {
    return { allowed: false, reason: "manual_mode" };
  }
  return { allowed: true, enforceOneActive: args.mode !== "shared" };
}

/** Может ли человек сам нажать «Взять» (для кнопок в приложении). */
export function canSelfClaim(mode: TaskFlowMode, actorCanAssign: boolean): boolean {
  return decideClaim({ mode, actorCanAssign }).allowed;
}
