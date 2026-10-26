/**
 * Smart-routing помощники для распределения обязательств по журналам.
 *
 * Используются `syncDailyJournalObligationsFor*` (Фаза 1, шаг 1.5),
 * UI настроек шаблона (`/settings/journals`, шаг 1.6) и адаптерами
 * TasksFlow когда им нужно знать «кому отдавать конкретный шаблон»
 * (шаг 1.9).
 *
 * Источники истины:
 *   - `JournalTemplate.fillMode` — единственный селектор стратегии
 *   - `JobPositionJournalAccess` — per-org white-list должностей
 *   - `UserJournalAccess` — per-user override (canWrite)
 *
 * Backward-compat: если для шаблона нет ни одной строки
 * `JobPositionJournalAccess` — считаем что разрешено всем должностям
 * (текущее поведение). Так миграция новых полей не ломает работающие
 * организации.
 */

import { db } from "@/lib/db";
import type { User } from "@prisma/client";

export const FILL_MODES = ["per-employee", "single", "sensor"] as const;
export type FillMode = (typeof FILL_MODES)[number];

export type EligibleEmployee = Pick<
  User,
  "id" | "name" | "role" | "jobPositionId" | "organizationId"
>;

/**
 * Нормализует `template.fillMode` (свободная строка в БД) в наш enum.
 * Дефолт `per-employee` повторяет default-значение колонки и текущую
 * семантику системы.
 */
export function getFillMode(template: { fillMode: string | null }): FillMode {
  if (
    template.fillMode === "single" ||
    template.fillMode === "sensor" ||
    template.fillMode === "per-employee"
  ) {
    return template.fillMode;
  }
  return "per-employee";
}

/**
 * Список сотрудников, которым в принципе можно отдавать обязательство
 * по шаблону. Не привязывается к дате — это статический фильтр
 * «кто из штата подходит».
 *
 * Правила (применяются в порядке приоритета):
 *   1. `UserJournalAccess.canWrite === true` — всегда eligible (override
 *      явно даёт доступ конкретному пользователю даже мимо должности).
 *   2. `UserJournalAccess.canWrite === false` — никогда не eligible.
 *   3. Если есть строки `JobPositionJournalAccess` для этого шаблона —
 *      пользователь eligible только если его `jobPositionId` в этом
 *      white-list-е.
 *   4. Если для шаблона нет ни одной строки `JobPositionJournalAccess` —
 *      back-compat: eligible все active не-root пользователи.
 *
 * Из выборки исключаются `isRoot=true` (платформа-уровень) и
 * `archivedAt != null` / `isActive=false` (уволенные/неактивные).
 */
export async function getEligibleEmployees(
  organizationId: string,
  templateId: string,
  /** Точка: сотрудники с непустым `buildingIds` подходят только на своих. */
  buildingId: string | null = null
): Promise<EligibleEmployee[]> {
  // UserJournalAccess хранит ссылку на шаблон через `templateCode`,
  // а не `templateId` — резолвим код один раз.
  const template = await db.journalTemplate.findUnique({
    where: { id: templateId },
    select: { code: true },
  });
  if (!template) return [];

  const [users, positionAccess, userAccess] = await Promise.all([
    db.user.findMany({
      where: {
        organizationId,
        isActive: true,
        archivedAt: null,
        isRoot: false,
      },
      select: {
        id: true,
        name: true,
        role: true,
        jobPositionId: true,
        organizationId: true,
        buildingIds: true,
      },
    }),
    db.jobPositionJournalAccess.findMany({
      where: { templateId, organizationId },
      select: { jobPositionId: true },
    }),
    db.userJournalAccess.findMany({
      where: { templateCode: template.code },
      select: { userId: true, canWrite: true },
    }),
  ]);

  const allowedPositions = new Set(
    positionAccess.map((a) => a.jobPositionId)
  );
  const userOverrides = new Map<string, boolean>(
    userAccess.map((a) => [a.userId, a.canWrite])
  );

  return users.filter((user) => {
    if (
      buildingId &&
      user.buildingIds.length > 0 &&
      !user.buildingIds.includes(buildingId)
    ) {
      return false;
    }
    const override = userOverrides.get(user.id);
    if (override === true) return true;
    if (override === false) return false;
    if (allowedPositions.size === 0) return true;
    if (!user.jobPositionId) return false;
    return allowedPositions.has(user.jobPositionId);
  });
}

/**
 * Выбирает единственного исполнителя для шаблона с `fillMode="single"`.
 *
 * Логика (Q1 = D — гибрид):
 *   1. Если в шаблоне зафиксирован `defaultAssigneeId` И этот
 *      пользователь до сих пор eligible — назначается он.
 *   2. Иначе round-robin: считаем obligations для этого template за
 *      последние 7 дней, выбираем сотрудника с наименьшим количеством;
 *      tie-break по `user.id` (стабильно).
 *   3. Если eligible-список пуст — возвращаем `null`. Вызывающая
 *      сторона должна решить что делать (логировать предупреждение,
 *      менеджеру нотификация).
 *
 * Дата `dateKey` нужна для round-robin окна (последние 7 дней относительно
 * этой даты). Передаём `utcDayStart(now)` из `journal-obligations.ts`.
 */
export async function pickSingleAssignee(
  organizationId: string,
  template: { id: string; defaultAssigneeId: string | null },
  dateKey: Date,
  /** Точка обязательства: исполнитель — из тех, кто на ней работает. */
  buildingId: string | null = null
): Promise<EligibleEmployee | null> {
  const eligible = await getEligibleEmployees(organizationId, template.id, buildingId);
  if (eligible.length === 0) return null;

  if (template.defaultAssigneeId) {
    const explicit = eligible.find(
      (u) => u.id === template.defaultAssigneeId
    );
    if (explicit) return explicit;
    // Default-исполнитель ушёл/не eligible — падаем на round-robin.
  }

  const since = new Date(dateKey.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recent = await db.journalObligation.groupBy({
    by: ["userId"],
    where: {
      organizationId,
      templateId: template.id,
      dateKey: { gte: since },
    },
    _count: { _all: true },
  });
  const counts = new Map<string, number>(
    recent.map((row) => [row.userId, row._count._all])
  );

  const ranked = [...eligible].sort((a, b) => {
    const ca = counts.get(a.id) ?? 0;
    const cb = counts.get(b.id) ?? 0;
    if (ca !== cb) return ca - cb;
    return a.id.localeCompare(b.id);
  });

  return ranked[0] ?? null;
}
