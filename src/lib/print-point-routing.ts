/**
 * Принтер своей точки (2026-11-01, решение владельца): журнал, отправленный
 * на печать на точке А, печатается принтером точки А и никогда — принтером
 * точки Б. Чистые правила без БД — их читают очередь агента, постановка
 * задания и тесты.
 *
 *  - агент точки X берёт задания точки X и общие (документ без точки);
 *  - агент без точки («Вся организация») берёт общие задания и задания
 *    точек, у которых своего подключённого принтера нет, — так организация
 *    с одним общим принтером печатает как раньше;
 *  - задание точки, у которой свой принтер есть, чужой агент не берёт.
 */

export type RoutingAgent = { buildingId: string | null };

/** Точки, у которых есть свой подключённый (не отключённый) принтер. */
export function pointsWithOwnAgent(agents: ReadonlyArray<{ buildingId: string | null; revokedAt?: Date | null }>): string[] {
  return [
    ...new Set(
      agents.filter((agent) => !agent.revokedAt && agent.buildingId).map((agent) => agent.buildingId as string),
    ),
  ];
}

/** Может ли агент взять задание точки `jobBuildingId` (null — общий документ). */
export function agentMayTakeJob(
  agent: RoutingAgent,
  jobBuildingId: string | null,
  pointsWithAgent: readonly string[],
): boolean {
  if (!jobBuildingId) return true;
  if (agent.buildingId) return agent.buildingId === jobBuildingId;
  return !pointsWithAgent.includes(jobBuildingId);
}

export type PrintJobQueueWhere = {
  OR?: Array<{ buildingId: string | null } | { buildingId: { notIn: string[] } }>;
};

/**
 * Условие очереди агента для `printJob.findFirst` — то же правило, что
 * `agentMayTakeJob`. Разворачивается в `where` через spread (своего `OR` у
 * запроса очереди нет). `NOT IN` в SQL отбрасывает NULL, поэтому общие
 * задания добавлены отдельно.
 */
export function printJobQueueWhere(agent: RoutingAgent, pointsWithAgent: readonly string[]): PrintJobQueueWhere {
  if (agent.buildingId) return { OR: [{ buildingId: null }, { buildingId: agent.buildingId }] };
  if (pointsWithAgent.length === 0) return {};
  return { OR: [{ buildingId: null }, { buildingId: { notIn: [...pointsWithAgent] } }] };
}

/**
 * Кто может поставить принтер на точку или отключить его. Руководство на
 * всю компанию (`scope` null) — любую точку организации и «Вся организация»;
 * руководитель точки — только принтеры своих точек и только на свои точки.
 * `current` — точка принтера сейчас (для нового — undefined).
 */
export function canManageAgentPoint(args: {
  scope: readonly string[] | null;
  current?: string | null;
  target?: string | null;
}): boolean {
  if (!args.scope) return true;
  const inScope = (id: string | null | undefined) => Boolean(id) && args.scope!.includes(id as string);
  if (args.current !== undefined && !inScope(args.current)) return false;
  if (args.target !== undefined && !inScope(args.target)) return false;
  return true;
}
