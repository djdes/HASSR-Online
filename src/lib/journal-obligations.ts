import { db } from "@/lib/db";
import { journalDisplayName, parseCustomNames } from "@/lib/custom-names";
import { buildingTargets, userBuildingTargets } from "@/lib/building-targets";
import { buildingWhere } from "@/lib/building-scope";
import { ALL_DAILY_JOURNAL_CODES } from "@/lib/daily-journal-codes";
import { getDisabledJournalCodes as loadDisabledJournalCodes } from "@/lib/disabled-journals";
import {
  getAllowedJournalCodes as loadAllowedJournalCodes,
  type JournalAclActor,
} from "@/lib/journal-acl";
import { isDocumentTemplate } from "@/lib/journal-document-helpers";
import { resolveJournalObligationTargetPath } from "@/lib/journal-obligation-links";
import {
  getTemplateTodaySummary as loadTemplateTodaySummary,
  type TemplateTodaySummary,
} from "@/lib/today-compliance";
import { isManagementRole } from "@/lib/user-roles";
import { isStaffDayOff, normalizeDayOffKind } from "@/lib/staff-days-off";
import {
  getEligibleEmployees,
  getFillMode,
  pickSingleAssignee as loadSingleAssignee,
  type FillMode,
} from "@/lib/journal-routing";
import { NOT_COMMISSION_WHERE } from "@/lib/journal-roster";

const DAILY_OBLIGATION_SOURCE = "daily-journal-sync" as const;
const PHASE_ONE_JOURNAL_RULES: Partial<
  Record<
    string,
    {
      countsAsDaily?: boolean;
      forceEntryTarget?: boolean;
    }
  >
> = {
  incoming_control: {
    countsAsDaily: true,
    forceEntryTarget: true,
  },
};

export type ObligationTemplate = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isDocument: boolean;
  /// "per-employee" | "single" | "sensor" — стратегия распределения
  /// (см. lib/journal-routing.ts). Optional чтобы существующие тесты
  /// (mock-данные без этого поля) не ломались — если undefined,
  /// `templateFillMode()` отдаёт "per-employee" (back-compat).
  fillMode?: FillMode;
  /// Используется только при fillMode="single" — явный исполнитель;
  /// если null/undefined — round-robin между eligible сотрудниками.
  defaultAssigneeId?: string | null;
};

function templateFillMode(template: ObligationTemplate): FillMode {
  return template.fillMode ?? "per-employee";
}

export type ObligationRow = {
  organizationId: string;
  userId: string;
  templateId: string;
  journalCode: string;
  kind: "daily-journal";
  dateKey: Date;
  status: "pending" | "done";
  targetPath: string;
  source: "daily-journal-sync";
  dedupeKey: string;
  /// Точка обязательства; null — организация без точек.
  buildingId: string | null;
  completedAt: Date | null;
};

export type OpenJournalObligation = {
  id: string;
  journalCode: string;
  targetPath: string;
  template: { name: string; description: string | null };
  /// Точка обязательства — подпись в Mini App и в сводках.
  buildingId?: string | null;
  buildingName?: string | null;
};

export type ExistingDailyObligation = {
  id: string;
  dedupeKey: string;
  status: "pending" | "done";
  completedAt: Date | null;
};

export type FoundJournalObligation = {
  id: string;
  userId: string;
  targetPath: string;
  openedAt: Date | null;
  buildingId?: string | null;
};

type SummaryRow = {
  userId: string;
  status: "pending" | "done";
};

type ActiveStaffUser = {
  id: string;
  organizationId: string;
};

type UserActor = JournalAclActor;

export type ObligationDeps = {
  getUserActor: (userId: string) => Promise<UserActor>;
  /// Выходной ли у сотрудника этот день (недельное правило + явные
  /// отметки, см. src/lib/staff-days-off.ts). В выходной ежедневные
  /// обязательства не раздаём — иначе повар в законный выходной
  /// получает «просроченные» журналы.
  isUserOffOn: (userId: string, date: Date) => Promise<boolean>;
  getAllowedJournalCodes: (actor: UserActor) => Promise<string[] | null>;
  getDisabledJournalCodes: (organizationId: string) => Promise<Set<string>>;
  listTemplates: () => Promise<ObligationTemplate[]>;
  /// Множество user-id, которым в принципе разрешено брать на себя
  /// этот шаблон (по white-list-у должностей + UserJournalAccess
  /// override). Per-employee режим использует это для фильтра
  /// «уборщица не получает фритюр».
  getEligibleUserIds: (
    organizationId: string,
    templateId: string
  ) => Promise<Set<string>>;
  /// Точки: на какие точки раздавать обязательства. С userId — точки
  /// сотрудника (`User.buildingIds` ∩ точки организации, пусто = все),
  /// без — все точки организации; без точек → `[null]`.
  getBuildingTargets: (
    organizationId: string,
    userId: string | null
  ) => Promise<Array<string | null>>;
  /// Выбор единственного исполнителя для шаблона с fillMode="single".
  /// `null` если eligible-список пуст.
  pickSingleAssignee: (args: {
    organizationId: string;
    template: ObligationTemplate;
    dateKey: Date;
  }) => Promise<{ id: string; organizationId: string } | null>;
  getTemplateTodaySummary: (
    organizationId: string,
    templateId: string,
    templateCode: string,
    now: Date,
    buildingId?: string | null
  ) => Promise<TemplateTodaySummary>;
  listExistingDailyObligations: (args: {
    userId: string;
    dateKey: Date;
    source: string;
  }) => Promise<ExistingDailyObligation[]>;
  deleteStaleDailyObligations: (ids: string[]) => Promise<void>;
  saveDailyObligations: (rows: ObligationRow[]) => Promise<ObligationRow[]>;
  listOpenRows: (args: {
    userId: string;
    dateKey: Date;
  }) => Promise<OpenJournalObligation[]>;
  findObligationById: (
    id: string,
    userId: string
  ) => Promise<FoundJournalObligation | null>;
  markOpened: (id: string, userId: string) => Promise<void>;
  listActiveStaffUsers: (
    organizationId: string
  ) => Promise<ActiveStaffUser[]>;
  listSummaryRows: (args: {
    organizationId: string;
    dateKey: Date;
    buildingId?: string | null;
  }) => Promise<SummaryRow[]>;
};

function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

function dateStamp(dateKey: Date): string {
  return dateKey.toISOString().slice(0, 10);
}

function buildDedupeKey(
  dateKey: Date,
  templateCode: string,
  buildingId: string | null = null
): string {
  // Без точки ключ прежний — существующие строки не пересоздаются.
  const base = `daily:${dateStamp(dateKey)}:${templateCode}`;
  return buildingId ? `${base}:${buildingId}` : base;
}

function normalizeObligationStatus(status: string): "pending" | "done" {
  return status === "done" ? "done" : "pending";
}

function getPhaseOneJournalRule(templateCode: string) {
  return PHASE_ONE_JOURNAL_RULES[templateCode];
}

function isDailyObligationCode(templateCode: string): boolean {
  return ALL_DAILY_JOURNAL_CODES.has(templateCode) ||
    getPhaseOneJournalRule(templateCode)?.countsAsDaily === true;
}

function usesDocumentTarget(template: ObligationTemplate): boolean {
  if (getPhaseOneJournalRule(template.code)?.forceEntryTarget === true) {
    return false;
  }
  return template.isDocument;
}

function createDefaultDeps(): ObligationDeps {
  return {
    async isUserOffOn(userId, date) {
      const [user, override] = await Promise.all([
        db.user.findUnique({
          where: { id: userId },
          select: { weeklyDaysOff: true },
        }),
        db.staffWorkOffDay.findUnique({
          where: { userId_date: { userId, date } },
          select: { kind: true },
        }),
      ]);
      if (!user) return false;
      return isStaffDayOff(
        user,
        date,
        override ? normalizeDayOffKind(override.kind) : null
      );
    },
    async getUserActor(userId) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isRoot: true },
      });
      if (!user) {
        throw new Error(`User not found: ${userId}`);
      }
      return user;
    },
    getAllowedJournalCodes: loadAllowedJournalCodes,
    getDisabledJournalCodes: loadDisabledJournalCodes,
    async listTemplates() {
      const templates = await db.journalTemplate.findMany({
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          fillMode: true,
          defaultAssigneeId: true,
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });

      return templates.map((template) => ({
        id: template.id,
        code: template.code,
        name: template.name,
        description: template.description,
        isDocument: isDocumentTemplate(template.code),
        fillMode: getFillMode(template),
        defaultAssigneeId: template.defaultAssigneeId,
      }));
    },
    async getEligibleUserIds(organizationId, templateId) {
      const eligible = await getEligibleEmployees(organizationId, templateId);
      return new Set(eligible.map((u) => u.id));
    },
    getBuildingTargets(organizationId, userId) {
      return userId
        ? userBuildingTargets(organizationId, userId)
        : buildingTargets(organizationId);
    },
    async pickSingleAssignee({ organizationId, template, dateKey }) {
      const picked = await loadSingleAssignee(
        organizationId,
        {
          id: template.id,
          defaultAssigneeId: template.defaultAssigneeId ?? null,
        },
        dateKey
      );
      return picked
        ? { id: picked.id, organizationId: picked.organizationId }
        : null;
    },
    getTemplateTodaySummary: (organizationId, templateId, templateCode, now, buildingId) =>
      loadTemplateTodaySummary(organizationId, templateId, templateCode, now, {
        buildingId: buildingId ?? null,
      }),
    async listExistingDailyObligations({ userId, dateKey, source }) {
      const rows = await db.journalObligation.findMany({
        where: {
          userId,
          dateKey,
          source,
        },
        select: {
          id: true,
          dedupeKey: true,
          status: true,
          completedAt: true,
        },
      });

      return rows.map((row) => ({
        ...row,
        status: normalizeObligationStatus(row.status),
      }));
    },
    async deleteStaleDailyObligations(ids) {
      if (ids.length === 0) return;

      await db.journalObligation.deleteMany({
        where: {
          id: {
            in: ids,
          },
        },
      });
    },
    async saveDailyObligations(rows) {
      if (rows.length === 0) return [];

      return Promise.all(
        rows.map(async (row) => {
          await db.journalObligation.upsert({
            where: {
              userId_dedupeKey: {
                userId: row.userId,
                dedupeKey: row.dedupeKey,
              },
            },
            create: {
              organizationId: row.organizationId,
              userId: row.userId,
              templateId: row.templateId,
              journalCode: row.journalCode,
              kind: row.kind,
              dateKey: row.dateKey,
              status: row.status,
              targetPath: row.targetPath,
              source: row.source,
              dedupeKey: row.dedupeKey,
              buildingId: row.buildingId,
              completedAt: row.completedAt,
            },
            update: {
              templateId: row.templateId,
              journalCode: row.journalCode,
              status: row.status,
              targetPath: row.targetPath,
              buildingId: row.buildingId,
              completedAt: row.completedAt,
            },
          });

          return row;
        })
      );
    },
    async listOpenRows({ userId, dateKey }) {
      const rows = await db.journalObligation.findMany({
        where: {
          userId,
          dateKey,
          status: "pending",
        },
        select: {
          id: true,
          journalCode: true,
          targetPath: true,
          buildingId: true,
          building: { select: { name: true } },
          template: {
            select: {
              name: true,
              description: true,
            },
          },
          // Свои названия организации: Telegram-дайджест, «Сегодня» в
          // боте и мини-приложении берут название журнала отсюда.
          organization: { select: { customNamesJson: true } },
        },
        orderBy: [{ template: { name: "asc" } }, { createdAt: "asc" }],
      });
      return rows.map((row) => ({
        id: row.id,
        journalCode: row.journalCode,
        targetPath: row.targetPath,
        template: {
          ...row.template,
          name: journalDisplayName(
            parseCustomNames(row.organization?.customNamesJson),
            row.journalCode,
            row.template.name
          ),
        },
        buildingId: row.buildingId,
        buildingName: row.building?.name ?? null,
      }));
    },
    async findObligationById(id, userId) {
      return db.journalObligation.findFirst({
        where: { id, userId },
        select: {
          id: true,
          userId: true,
          targetPath: true,
          openedAt: true,
          buildingId: true,
        },
      });
    },
    async markOpened(id, userId) {
      await db.journalObligation.updateMany({
        where: { id, userId, openedAt: null },
        data: { openedAt: new Date() },
      });
    },
    async listActiveStaffUsers(organizationId) {
      const users = await db.user.findMany({
        where: {
          organizationId,
          isActive: true,
          archivedAt: null,
          ...NOT_COMMISSION_WHERE,
        },
        select: {
          id: true,
          organizationId: true,
          role: true,
          isRoot: true,
        },
      });

      return users
        .filter((user) => !user.isRoot && !isManagementRole(user.role))
        .map((user) => ({
          id: user.id,
          organizationId: user.organizationId,
        }));
    },
    async listSummaryRows({ organizationId, dateKey, buildingId }) {
      const rows = await db.journalObligation.findMany({
        where: {
          organizationId,
          dateKey,
          ...buildingWhere(buildingId),
        },
        select: {
          userId: true,
          status: true,
        },
      });

      return rows.map((row) => ({
        ...row,
        status: normalizeObligationStatus(row.status),
      }));
    },
  };
}

function resolveDeps(overrides?: Partial<ObligationDeps>): ObligationDeps {
  return {
    ...createDefaultDeps(),
    ...overrides,
  };
}

export async function syncDailyJournalObligationsForUser(
  args: { userId: string; organizationId: string; now?: Date },
  overrides?: Partial<ObligationDeps>
): Promise<ObligationRow[]> {
  const deps = resolveDeps(overrides);
  const now = args.now ?? new Date();
  const dateKey = utcDayStart(now);
  // Выходной сотрудника — не его рабочий день: чистим уже созданные
  // на сегодня обязательства и выходим, ничего не назначая.
  if (await deps.isUserOffOn(args.userId, dateKey)) {
    const staleRows = await deps.listExistingDailyObligations({
      userId: args.userId,
      dateKey,
      source: DAILY_OBLIGATION_SOURCE,
    });
    await deps.deleteStaleDailyObligations(staleRows.map((row) => row.id));
    return [];
  }
  const actor = await deps.getUserActor(args.userId);
  const [allowedCodes, disabledCodes, templates, existingRows] = await Promise.all([
    deps.getAllowedJournalCodes(actor),
    deps.getDisabledJournalCodes(args.organizationId),
    deps.listTemplates(),
    deps.listExistingDailyObligations({
      userId: args.userId,
      dateKey,
      source: DAILY_OBLIGATION_SOURCE,
    }),
  ]);
  const existingByDedupeKey = new Map(
    existingRows.map((row) => [row.dedupeKey, row])
  );

  // В per-user sync создаём obligation только для шаблонов с
  // fillMode="per-employee". `single` обрабатывает org-level sync
  // (один pickSingleAssignee per template), а `sensor` пропускается
  // совсем (Фаза 2 заменит на авто-данные с датчика).
  const eligibleSets = new Map<string, Set<string>>();
  const filteredTemplates: ObligationTemplate[] = [];
  for (const template of templates) {
    if (!isDailyObligationCode(template.code)) continue;
    if (disabledCodes.has(template.code)) continue;
    if (templateFillMode(template) !== "per-employee") continue;
    if (allowedCodes !== null && !allowedCodes.includes(template.code)) {
      continue;
    }
    const eligible = await deps.getEligibleUserIds(
      args.organizationId,
      template.id
    );
    eligibleSets.set(template.id, eligible);
    if (!eligible.has(args.userId)) continue;
    filteredTemplates.push(template);
  }

  // Точки: по обязательству на каждый журнал на каждой точке сотрудника;
  // без точек — одно, как раньше (buildingId = null).
  const userTargets = await deps.getBuildingTargets(args.organizationId, args.userId);
  const rows: ObligationRow[] = [];
  const keepDedupeKeys = new Set<string>();
  for (const template of filteredTemplates) {
    const isDocumentTarget = usesDocumentTarget(template);
    for (const buildingId of userTargets) {
    const summary = await deps.getTemplateTodaySummary(
      args.organizationId,
      template.id,
      template.code,
      now,
      buildingId
    );

    if (summary.aperiodic) {
      continue;
    }
    const dedupeKey = buildDedupeKey(dateKey, template.code, buildingId);
    const existing = existingByDedupeKey.get(dedupeKey);
    keepDedupeKeys.add(dedupeKey);
    const completedAt =
      summary.filled && existing?.status === "done" && existing.completedAt
        ? existing.completedAt
        : summary.filled
          ? now
          : null;
    const targetPath = isDocumentTarget
      ? resolveJournalObligationTargetPath({
          journalCode: template.code,
          isDocument: true,
          activeDocumentId: summary.activeDocumentId,
        })
      : resolveJournalObligationTargetPath({
          journalCode: template.code,
          isDocument: false,
          activeDocumentId: null,
        });

    rows.push({
      organizationId: args.organizationId,
      userId: args.userId,
      templateId: template.id,
      journalCode: template.code,
      kind: "daily-journal",
      dateKey,
      status: summary.filled ? "done" : "pending",
      targetPath,
      source: DAILY_OBLIGATION_SOURCE,
      dedupeKey,
      buildingId,
      completedAt,
    });
    }
  }

  const staleIds = existingRows
    .filter((row) => !keepDedupeKeys.has(row.dedupeKey))
    .map((row) => row.id);
  await deps.deleteStaleDailyObligations(staleIds);

  return deps.saveDailyObligations(rows);
}

export async function listOpenJournalObligationsForUser(
  userId: string,
  now: Date = new Date(),
  overrides?: Partial<ObligationDeps>
): Promise<OpenJournalObligation[]> {
  const deps = resolveDeps(overrides);
  const rows = await deps.listOpenRows({
    userId,
    dateKey: utcDayStart(now),
  });
  return [...rows].sort((left, right) =>
    left.template.name.localeCompare(right.template.name)
  );
}

export async function getJournalObligationById(
  id: string,
  userId: string,
  overrides?: Partial<ObligationDeps>
): Promise<FoundJournalObligation | null> {
  const deps = resolveDeps(overrides);
  return deps.findObligationById(id, userId);
}

export async function markJournalObligationOpened(
  id: string,
  userId: string,
  overrides?: Partial<ObligationDeps>
): Promise<void> {
  const deps = resolveDeps(overrides);
  await deps.markOpened(id, userId);
}

export async function syncDailyJournalObligationsForOrganization(
  organizationId: string,
  now: Date = new Date(),
  overrides?: Partial<ObligationDeps>
): Promise<void> {
  const deps = resolveDeps(overrides);
  const users = await deps.listActiveStaffUsers(organizationId);

  // 1. Per-employee режим: каждому подходящему пользователю —
  // обязательство по каждому подходящему шаблону.
  await Promise.all(
    users.map((user) =>
      syncDailyJournalObligationsForUser(
        {
          userId: user.id,
          organizationId: user.organizationId,
          now,
        },
        overrides
      )
    )
  );

  // 2. Single-режим: для каждого шаблона ровно одно обязательство
  // → выбранному pickSingleAssignee. Sensor пропускаем (Фаза 2).
  const dateKey = utcDayStart(now);
  const [templates, disabledCodes] = await Promise.all([
    deps.listTemplates(),
    deps.getDisabledJournalCodes(organizationId),
  ]);
  // Точки: единственное обязательство — на каждую точку (исполнитель
  // выбирается тем же раунд-робином; ограничение по точке — в eligibility).
  const orgTargets = await deps.getBuildingTargets(organizationId, null);
  for (const template of templates) {
    if (!isDailyObligationCode(template.code)) continue;
    if (disabledCodes.has(template.code)) continue;
    if (templateFillMode(template) !== "single") continue;

    for (const buildingId of orgTargets) {
    const summary = await deps.getTemplateTodaySummary(
      organizationId,
      template.id,
      template.code,
      now,
      buildingId
    );
    if (summary.aperiodic) continue;

    const assignee = await deps.pickSingleAssignee({
      organizationId,
      template,
      dateKey,
    });
    if (!assignee) continue;
    // Тот же принцип, что и в per-employee: в свой выходной человек
    // не получает единственную задачу по журналу.
    if (await deps.isUserOffOn(assignee.id, dateKey)) continue;

    const isDocumentTarget = usesDocumentTarget(template);
    const dedupeKey = buildDedupeKey(dateKey, template.code, buildingId);
    const targetPath = isDocumentTarget
      ? resolveJournalObligationTargetPath({
          journalCode: template.code,
          isDocument: true,
          activeDocumentId: summary.activeDocumentId,
        })
      : resolveJournalObligationTargetPath({
          journalCode: template.code,
          isDocument: false,
          activeDocumentId: null,
        });

    await deps.saveDailyObligations([
      {
        organizationId,
        userId: assignee.id,
        templateId: template.id,
        journalCode: template.code,
        kind: "daily-journal",
        dateKey,
        status: summary.filled ? "done" : "pending",
        targetPath,
        source: DAILY_OBLIGATION_SOURCE,
        dedupeKey,
        buildingId,
        completedAt: summary.filled ? now : null,
      },
    ]);
    }
  }

  // Stale-cleanup для шаблонов, переехавших из per-employee в single
  // (или сменивших defaultAssignee), делается в шаге 1.7 — там
  // одноразовая миграция вычистит старые obligations. После неё
  // новый код стабильно создаёт ровно один single-obligation на день.

  // 3. Sensor-failover (Q6 = hybrid): для шаблонов с fillMode="sensor"
  // проверяем когда последний раз приходили данные с датчика. Если
  // тишина больше 24 часов — создаём obligation для штата (как single)
  // чтобы заполнили вручную, а не теряли запись за день. Когда датчик
  // оживёт — следующий cron-tick `/api/tuya/collect` снова заполнит,
  // и obligation на следующий день уже не понадобится.
  const SENSOR_FAILOVER_THRESHOLD_MS = 24 * 60 * 60 * 1000;
  const failoverThreshold = new Date(
    now.getTime() - SENSOR_FAILOVER_THRESHOLD_MS
  );
  for (const template of templates) {
    if (!isDailyObligationCode(template.code)) continue;
    if (disabledCodes.has(template.code)) continue;
    if (templateFillMode(template) !== "sensor") continue;

    // Когда последний раз приходили данные с датчика? Смотрим на
    // JournalEntry, который создаёт `/api/tuya/collect`. Если за
    // 24 часа ни одной записи — датчик молчит.
    const latestEntry = await db.journalEntry.findFirst({
      where: {
        organizationId,
        templateId: template.id,
        createdAt: { gte: failoverThreshold },
      },
      select: { id: true },
    });
    if (latestEntry) continue; // датчик жив, ничего не делаем

    // Failover: создаём obligation как single. Это «человек уберёт за
    // датчиком». Если defaultAssigneeId на шаблоне есть — отдаём ему,
    // иначе round-robin.
    const summary = await deps.getTemplateTodaySummary(
      organizationId,
      template.id,
      template.code,
      now
    );
    if (summary.aperiodic) continue;

    const assignee = await deps.pickSingleAssignee({
      organizationId,
      template,
      dateKey,
    });
    if (!assignee) continue;
    // Тот же принцип, что и в per-employee: в свой выходной человек
    // не получает единственную задачу по журналу.
    if (await deps.isUserOffOn(assignee.id, dateKey)) continue;

    const isDocumentTarget = usesDocumentTarget(template);
    const dedupeKey = buildDedupeKey(dateKey, template.code);
    const targetPath = isDocumentTarget
      ? resolveJournalObligationTargetPath({
          journalCode: template.code,
          isDocument: true,
          activeDocumentId: summary.activeDocumentId,
        })
      : resolveJournalObligationTargetPath({
          journalCode: template.code,
          isDocument: false,
          activeDocumentId: null,
        });

    await deps.saveDailyObligations([
      {
        organizationId,
        userId: assignee.id,
        templateId: template.id,
        journalCode: template.code,
        kind: "daily-journal",
        dateKey,
        status: summary.filled ? "done" : "pending",
        targetPath,
        source: DAILY_OBLIGATION_SOURCE,
        dedupeKey,
        buildingId: null,
        completedAt: summary.filled ? now : null,
      },
    ]);
  }
}

export async function getManagerObligationSummary(
  organizationId: string,
  now: Date = new Date(),
  overrides?: Partial<ObligationDeps>,
  /** Точка: сводка только по ней (и общим обязательствам); null — вся организация. */
  buildingId: string | null = null
): Promise<{
  total: number;
  pending: number;
  done: number;
  employeesWithPending: number;
}> {
  const deps = resolveDeps(overrides);
  const rows = await deps.listSummaryRows({
    organizationId,
    dateKey: utcDayStart(now),
    buildingId,
  });

  const pending = rows.filter((row) => row.status === "pending").length;
  const done = rows.filter((row) => row.status === "done").length;

  return {
    total: rows.length,
    pending,
    done,
    employeesWithPending: new Set(
      rows.filter((row) => row.status === "pending").map((row) => row.userId)
    ).size,
  };
}
