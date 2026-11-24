import { Prisma } from "@prisma/client";

import { normalizePhone } from "@/lib/phone";
import { ensureRoomMirrorArea, renameRoomMirrorArea } from "@/lib/area-building-sync";
import { checkJournalLimit, checkPointsForCreation } from "@/lib/billing.server";
import { OFFICE_BUILDING_KIND } from "@/lib/building-scope";
import { parseScopeSteps, type ScopeStep } from "@/lib/cleaning-document";
import { syncRoomChecklistItems } from "@/lib/cleaning-room-checklist-sync";
import { normalizeClimateRoomNorms, type ClimateRoomNorms } from "@/lib/climate-document";
import { checklistDefinitionSchema, type ChecklistDefinition } from "@/lib/custom-checklists";
import {
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  applyEquipmentNormToColdConfig,
  normalizeColdEquipmentDocumentConfig,
} from "@/lib/cold-equipment-document";
import { db } from "@/lib/db";
import {
  naturalKey,
  pickExchangeFields,
  rowHash,
  type ExchangeEntity,
  type ExchangeFieldValue,
  type ExchangeFields,
  type ExchangeKind,
  type ExchangeScope,
} from "@/lib/directory-exchange/kinds";
import type { ExchangeRow } from "@/lib/directory-exchange/plan";
import { isFryerEquipmentType } from "@/lib/fryer-oil-equipment-link";
import { syncFryerOilDocumentsSafe } from "@/lib/fryer-oil-equipment-sync";
import { parseJournalAutomationJson, type JournalAutomationMap } from "@/lib/journal-automation";
import { AUTOMATION_FEATURES, readStoredAutomation, type JournalAutomationControls } from "@/lib/journal-controls";
import { peekJournalControls, updateJournalControls } from "@/lib/journal-controls.server";
import { setDisabledJournalCodes } from "@/lib/disabled-journals";
import { loadBuildingJournalSettings } from "@/lib/building-settings";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { guessRoomKind } from "@/lib/orphan-areas";
import { DEFAULT_PRODUCT_KIND, isProductKind, isServingTemp } from "@/lib/product-kinds";
import { ROOM_KINDS, type RoomKind } from "@/lib/room-kinds";
import { createStaffMember } from "@/lib/staff-create";
import { normalizeWeeklyDaysOff } from "@/lib/staff-days-off";
import { tryAutolinkTasksflowByPhone } from "@/lib/tasksflow-autolink";
import { isManagementRole } from "@/lib/user-roles";
import { syncUvDocumentPoints } from "@/lib/uv-document-points";
import { isUvLampEquipment } from "@/lib/uv-lamp";
import { openOrganizationOffice } from "@/lib/organization-office.server";

/**
 * Обмен справочниками — работа с базой по каждой сущности: чтение строк
 * организации в виде, понятном планировщику, и применение операций
 * «создать» / «обновить».
 *
 * Создание идёт теми же правилами, что и у ручного ввода: сотрудник — через
 * `createStaffMember` (места тарифа, доступ к журналам), объект — через
 * `checkPointsForCreation` (точки тарифа), помещение заводит цех-зеркало,
 * цех — помещение-зеркало. Отказ тарифа и совпадение названий — не ошибка
 * обмена, а пропуск со счётчиком.
 *
 * Правило Р4 держится здесь: читаются только линейные сотрудники без входа,
 * должности категории staff и объекты без офиса; при записи не трогаются
 * почта, пароль, роль, Telegram, датчики (`tuyaDeviceId`) и ответственные.
 *
 * Правило Р5 (обмен между аккаунтами) — параметр `scope`: в составе
 * `foreign` телефон и выходные сотрудника и журналы должности не читаются из
 * базы, не пишутся при создании и не трогаются при обновлении.
 *
 * Помещение переносится с графиками уборки и нормами климата (Р8.3), должность
 * — с журналами, к которым у неё есть доступ (Р8.2): поля в каноничном виде —
 * ниже, «поля помещения и должности».
 *
 * Настройки журналов организации (Р8.1) — одна запись с id организации:
 * выключенные журналы, автоматика по журналам и общие переключатели
 * автоматики; читаются без записи в базу, пишутся только у организации —
 * настройки точек обмен не трогает. Шаблоны чек-листов (Р8.4) — название и
 * содержание без ссылок на файлы-примеры; назначения не переносятся. Поля —
 * ниже, «настройки журналов и чек-листы».
 */

export type EntityRow = ExchangeRow & {
  name: string;
  /** Подпись к записи в окне переноса: должность, объект, цех, поставщик. */
  detail: string | null;
  fields: ExchangeFields;
  /** Родитель в своей организации (должность, объект, цех). */
  parentId: string | null;
  /** Группа родителя — общая для участников обмена. */
  parentGroupId: string | null;
};

/** Группа родителя по его id в этой организации; null — родитель не обменивается. */
export type ParentGroupLookup = (parentId: string) => string | null;

/**
 * `mirrorId` — зеркало, которое создание завело само (цех нового помещения,
 * помещение нового цеха); уже существовавшее одноимённое зеркало сюда не
 * попадает. По нему отмена из истории обмена убирает только своё зеркало.
 */
export type CreateOutcome = { status: "created"; id: string; mirrorId?: string } | { status: "limit" } | { status: "conflict" };
/** `limit` — правка не помещается в тариф получателя (настройки журналов: включённых журналов больше, чем можно). */
export type UpdateOutcome = { status: "updated" } | { status: "conflict" } | { status: "missing" } | { status: "limit" };

const STAFF_CATEGORY = "staff";
const EXCHANGE_SOURCE = "directory-exchange";
const AUTO_AREA_DESCRIPTION = "Авто-создан из Помещения";
/** Цеха и оборудование офиса не переносятся вместе с самим офисом. */
const NOT_OFFICE_AREA_WHERE = {
  OR: [{ buildingId: null }, { building: { is: { kind: { not: OFFICE_BUILDING_KIND } } } }],
};

function text(value: unknown, max = 500): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function isUniqueConflict(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

/**
 * Описание цеха, заведённого зеркалом помещения, — служебное и содержит id
 * помещения своей организации. В обмен оно не идёт: иначе одинаковые цеха
 * считались бы разными.
 */
function exchangedAreaDescription(description: string | null): string | null {
  const value = text(description, 1000);
  return value && !value.startsWith(AUTO_AREA_DESCRIPTION) ? value : null;
}

/** Единственный объект организации (без офиса) — место цеха без объекта. */
async function soleObjectId(organizationId: string): Promise<string | null> {
  const objects = await db.building.findMany({
    where: { organizationId, kind: { not: OFFICE_BUILDING_KIND } },
    select: { id: true },
    take: 2,
  });
  return objects.length === 1 ? objects[0].id : null;
}

/* ───────────────────────── поля помещения и должности ───────────────────────── */

/**
 * Список в поле обмена — каноничной JSON-строкой: одинаковое содержимое даёт
 * одну строку в любой организации. Пустой список — «нет» (null), как и
 * отсутствие поля: в отпечаток он не входит.
 */
function jsonList(list: readonly unknown[]): string | null {
  return list.length > 0 ? JSON.stringify(list) : null;
}

function parseJson(value: ExchangeFieldValue | undefined): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** Шаги уборки — как их хранит карточка помещения (`parseScopeSteps`, не больше 50). */
function scopeSteps(raw: unknown): ScopeStep[] {
  return parseScopeSteps(raw).slice(0, 50);
}

const scopeLabels = (steps: readonly ScopeStep[]) => steps.map((step) => step.label);
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

const MONTH_DAY = /^([1-9]|[12][0-9]|3[01]|last)$/;
const monthDayOrder = (day: string) => (day === "last" ? 32 : Number(day));

/** Дни месяца графика: без повторов и мусора, по порядку, «last» — последним. */
function monthDays(raw: unknown): string[] {
  const days = Array.isArray(raw) ? raw.filter((day): day is string => typeof day === "string" && MONTH_DAY.test(day)) : [];
  return [...new Set(days)].sort((a, b) => monthDayOrder(a) - monthDayOrder(b));
}

/** Дни недели графика — маска 0…127 (бит 0 — понедельник). */
function dayMask(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 127 ? value : fallback;
}

function scheduleType(value: unknown): "weekly" | "monthly" {
  return value === "monthly" ? "monthly" : "weekly";
}

/** Нормы климата (`normalizeClimateRoomNorms`) с постоянным порядком ключей; null — нормы не заданы. */
function climateNorms(raw: unknown): ClimateRoomNorms | null {
  const norms = normalizeClimateRoomNorms(raw);
  if (!norms) return null;
  const metric = (value: ClimateRoomNorms["temperature"]) => ({ enabled: value.enabled, min: value.min, max: value.max });
  return { temperature: metric(norms.temperature), humidity: metric(norms.humidity) };
}

type RoomSchedule = {
  currentScope: unknown;
  generalScope: unknown;
  currentDays: number;
  generalDays: number;
  currentScheduleType: string;
  generalScheduleType: string;
  currentMonthDays: unknown;
  generalMonthDays: unknown;
  detergent: string | null;
  requirePhoto: boolean;
  climateNorms: unknown;
};

/**
 * Графики уборки и нормы климата помещения — поля обмена (Р8.3). Ссылок на
 * записи организации в них нет; ответственные (уборщики, проверяющие, «кто
 * заполняет») — люди своей организации и не читаются.
 */
function roomScheduleFields(room: RoomSchedule): ExchangeFields {
  const norms = climateNorms(room.climateNorms);
  return {
    currentScope: jsonList(scopeSteps(room.currentScope)),
    generalScope: jsonList(scopeSteps(room.generalScope)),
    currentDays: dayMask(room.currentDays, 127),
    generalDays: dayMask(room.generalDays, 0),
    currentScheduleType: scheduleType(room.currentScheduleType),
    generalScheduleType: scheduleType(room.generalScheduleType),
    currentMonthDays: jsonList(monthDays(room.currentMonthDays)),
    generalMonthDays: jsonList(monthDays(room.generalMonthDays)),
    detergent: text(room.detergent, 500),
    requirePhoto: room.requirePhoto === true,
    climateNorms: norms ? JSON.stringify(norms) : null,
  };
}

/** Обратно: графики и нормы помещения из полей образца — в том же виде, в каком их читает `roomScheduleFields`. */
function roomScheduleData(fields: ExchangeFields) {
  return {
    currentScope: scopeSteps(parseJson(fields.currentScope)),
    generalScope: scopeSteps(parseJson(fields.generalScope)),
    currentDays: dayMask(fields.currentDays, 127),
    generalDays: dayMask(fields.generalDays, 0),
    currentScheduleType: scheduleType(fields.currentScheduleType),
    generalScheduleType: scheduleType(fields.generalScheduleType),
    currentMonthDays: monthDays(parseJson(fields.currentMonthDays)),
    generalMonthDays: monthDays(parseJson(fields.generalMonthDays)),
    detergent: text(fields.detergent, 500) ?? "",
    requirePhoto: fields.requirePhoto === true,
    climateNorms: climateNorms(parseJson(fields.climateNorms)),
  };
}

const ROOM_SCHEDULE_SELECT = {
  currentScope: true,
  generalScope: true,
  currentDays: true,
  generalDays: true,
  currentScheduleType: true,
  generalScheduleType: true,
  currentMonthDays: true,
  generalMonthDays: true,
  detergent: true,
  requirePhoto: true,
  climateNorms: true,
} as const;

/** Коды журналов, к которым у должностей есть доступ (`JobPositionJournalAccess`): должность → коды по алфавиту. */
async function positionJournalCodes(organizationId: string, positionIds: readonly string[]): Promise<Map<string, string[]>> {
  const codes = new Map<string, string[]>();
  if (positionIds.length === 0) return codes;
  const rows = await db.jobPositionJournalAccess.findMany({
    where: { organizationId, jobPositionId: { in: [...positionIds] } },
    select: { jobPositionId: true, template: { select: { code: true } } },
  });
  for (const row of rows) {
    const list = codes.get(row.jobPositionId);
    if (list) list.push(row.template.code);
    else codes.set(row.jobPositionId, [row.template.code]);
  }
  for (const [id, list] of codes) codes.set(id, [...new Set(list)].sort());
  return codes;
}

/**
 * Журналы должности — как у образца (Р8.2): по кодам шаблонов (шаблоны общие
 * для всех организаций) недостающие строки доступа заводятся, лишние
 * удаляются. Обмен повторяет явный перечень должности-образца; у шаблона, к
 * которому у получателя не осталось ни одной строки, доступ снова «у всех
 * должностей» — так же, как после такой же правки руками
 * (`PUT /api/settings/positions/[id]/journals`).
 *
 * Пустой перечень образца — «сведений нет», а не «закройте всё» (как пустой
 * телефон сотрудника): у организации, где доступ по должностям не настроен,
 * переименование должности не стирает настроенный доступ соседей.
 */
async function syncPositionJournals(organizationId: string, positionId: string, value: ExchangeFieldValue | undefined) {
  const raw = parseJson(value);
  const codes = Array.isArray(raw) ? raw.filter((code): code is string => typeof code === "string" && code !== "") : [];
  if (codes.length === 0) return;
  const templates = await db.journalTemplate.findMany({ where: { code: { in: codes } }, select: { id: true } });
  if (templates.length === 0) return;
  const templateIds = templates.map((template) => template.id);
  await db.$transaction([
    db.jobPositionJournalAccess.deleteMany({ where: { organizationId, jobPositionId: positionId, templateId: { notIn: templateIds } } }),
    db.jobPositionJournalAccess.createMany({
      data: templateIds.map((templateId) => ({ organizationId, jobPositionId: positionId, templateId })),
      skipDuplicates: true,
    }),
  ]);
}

/* ───────────────────────── настройки журналов и чек-листы ───────────────────────── */

type JournalFlags = { autoCreate: boolean; autoFill: boolean };

/** Коды журналов: непустые строки без повторов, по алфавиту. */
function journalCodes(raw: unknown): string[] {
  const codes = Array.isArray(raw) ? raw.filter((code): code is string => typeof code === "string" && code !== "") : [];
  return [...new Set(codes)].sort();
}

/**
 * Автоматика по журналам (`journalAutomationJson`) — только флаги, коды по
 * алфавиту. Ответственные и список сотрудников — люди своей организации, в
 * обмен они не идут.
 */
function journalAutomationFlags(raw: unknown): Record<string, JournalFlags> {
  const map = parseJournalAutomationJson(raw);
  return Object.fromEntries(
    Object.keys(map)
      .sort()
      .map((code) => [code, { autoCreate: map[code].autoCreate, autoFill: map[code].autoFill }]),
  );
}

/** Общие переключатели автоматики в постоянном порядке ключей. */
function automationSwitches(automation: JournalAutomationControls): JournalAutomationControls {
  const switches = { enabled: automation.enabled } as JournalAutomationControls;
  for (const feature of AUTOMATION_FEATURES) switches[feature] = automation[feature] === true;
  return switches;
}

/** Переключатели из поля образца; мусор — null (не менять). */
function parsedAutomation(value: ExchangeFieldValue | undefined): JournalAutomationControls | null {
  const automation = readStoredAutomation({ automation: parseJson(value) }).automation;
  return automation ? automationSwitches(automation) : null;
}

/** Поля записи «настройки журналов» (Р8.1). */
function journalSettingsFields(
  organization: { disabledJournalCodes: unknown; autoJournalCodes: unknown; journalAutomationJson: unknown },
  automation: JournalAutomationControls,
): ExchangeFields {
  const flags = journalAutomationFlags(organization.journalAutomationJson);
  return {
    disabledJournalCodes: jsonList(journalCodes(organization.disabledJournalCodes)),
    autoJournalCodes: jsonList(journalCodes(organization.autoJournalCodes)),
    journalAutomation: Object.keys(flags).length > 0 ? JSON.stringify(flags) : null,
    automation: JSON.stringify(automationSwitches(automation)),
  };
}

/**
 * Автоматика получателя по флагам образца. Ответственные и список
 * сотрудников по журналу остаются свои; журнал, которого у образца в карте
 * нет, но у получателя для него выбраны люди, остаётся с флагами, какие у
 * образца даёт легаси-список (`getJournalAutomation`: автосоздание — по
 * списку, автозаполнение — нет).
 */
function mergeJournalAutomation(
  current: JournalAutomationMap,
  flags: Readonly<Record<string, JournalFlags>>,
  autoCodes: readonly string[],
): JournalAutomationMap {
  const people = (code: string) => {
    const own = current[code];
    return { ...(own?.responsibles ? { responsibles: own.responsibles } : {}), ...(own?.staff ? { staff: own.staff } : {}) };
  };
  const next: JournalAutomationMap = {};
  for (const [code, value] of Object.entries(flags)) next[code] = { autoCreate: value.autoCreate, autoFill: value.autoFill, ...people(code) };
  for (const [code, own] of Object.entries(current)) {
    if (next[code] || (!own.responsibles && !own.staff)) continue;
    next[code] = { autoCreate: autoCodes.includes(code), autoFill: false, ...people(code) };
  }
  return next;
}

/**
 * Автозаполнение журнала включили или выключили — тот же флаг у открытых
 * документов организации, как в PUT /api/organizations/auto-journals (иначе
 * крон смотрел бы на старый флаг документа). Документы точек со своей
 * автоматикой живут её настройками и не трогаются. Best-effort.
 */
async function cascadeDocumentAutoFill(organizationId: string, before: JournalAutomationMap, after: JournalAutomationMap) {
  const codes = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (code) => (before[code]?.autoFill ?? false) !== (after[code]?.autoFill ?? false),
  );
  if (codes.length === 0) return;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  try {
    for (const code of codes) {
      await db.journalDocument.updateMany({
        where: {
          organizationId,
          status: "active",
          template: { code },
          dateTo: { gte: today },
          OR: [{ buildingId: null }, { building: { is: { journalAutomationJson: { equals: Prisma.DbNull } } } }],
        },
        data: { autoFill: after[code]?.autoFill ?? false },
      });
    }
  } catch (error) {
    console.error("[directory-exchange] journal autofill cascade failed", error);
  }
}

/**
 * Привести настройки журналов организации к образцу (Р8.1): только поля
 * организации и общие переключатели автоматики (`updateJournalControls`, без
 * фото датчиков и мастера бракеража). Наборы и автоматика точек со своими
 * настройками не трогаются. Включённых журналов больше, чем позволяет тариф,
 * — `limit`, ничего не меняется (как в PATCH /api/settings/journals).
 */
async function updateJournalSettings(organizationId: string, entityId: string, source: EntityRow): Promise<UpdateOutcome> {
  if (entityId !== organizationId) return { status: "missing" };
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { journalAutomationJson: true },
  });
  if (!organization) return { status: "missing" };
  const disabled = journalCodes(parseJson(source.fields.disabledJournalCodes));
  const autoCodes = journalCodes(parseJson(source.fields.autoJournalCodes));
  const limit = await checkJournalLimit(organizationId, disabled, { source: EXCHANGE_SOURCE });
  if (!limit.ok) return { status: "limit" };
  const before = parseJournalAutomationJson(organization.journalAutomationJson);
  const after = mergeJournalAutomation(before, journalAutomationFlags(parseJson(source.fields.journalAutomation)), autoCodes);
  // Выключенные журналы — тем же путём, что «Вся организация» в настройках: у организации
  // выключено только то, что выключено на всех её точках со своим набором (disabled-journals.ts).
  await setDisabledJournalCodes(organizationId, disabled, null);
  await db.organization.update({
    where: { id: organizationId },
    data: { autoJournalCodes: autoCodes, journalAutomationJson: after as Prisma.InputJsonObject },
  });
  const automation = parsedAutomation(source.fields.automation);
  if (automation) {
    const { controls } = await peekJournalControls(organizationId);
    const current = automationSwitches(controls.automation);
    if (JSON.stringify(current) !== JSON.stringify(automation)) await updateJournalControls(organizationId, { automation });
  }
  await cascadeDocumentAutoFill(organizationId, before, after);
  return { status: "updated" };
}

/** JSON с ключами по алфавиту: одинаковое содержимое — одна строка в любой организации. */
function canonicalJson(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.keys(item as Record<string, unknown>)
              .sort()
              .map((key) => [key, sort((item as Record<string, unknown>)[key])]),
          )
        : item;
  return JSON.stringify(sort(value));
}

/**
 * Содержание шаблона чек-листа (Р8.4) — как его проверяет конструктор
 * (`checklistDefinitionSchema`), без ссылок на файлы-примеры: файлы
 * (`ChecklistAttachment`) свои у каждой организации. Не проходит проверку —
 * null: такой шаблон не переносится.
 */
function checklistDefinition(raw: unknown): ChecklistDefinition | null {
  const parsed = checklistDefinitionSchema.safeParse(raw);
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    sections: parsed.data.sections.map((section) => ({
      ...section,
      categories: section.categories.map((category) => ({
        ...category,
        questions: category.questions.map(({ references: _references, ...question }) => question),
      })),
    })),
  };
}

/**
 * Свои файлы-примеры получателя остаются при правке шаблона: у вопроса с тем
 * же id ссылки — его прежние (в отпечаток ссылки не входят).
 */
function withOwnReferences(definition: ChecklistDefinition, currentRaw: unknown): ChecklistDefinition {
  const current = checklistDefinitionSchema.safeParse(currentRaw);
  if (!current.success) return definition;
  const references = new Map<string, string[]>();
  for (const section of current.data.sections) {
    for (const category of section.categories) {
      for (const question of category.questions) if (question.references?.length) references.set(question.id, question.references);
    }
  }
  if (references.size === 0) return definition;
  return {
    ...definition,
    sections: definition.sections.map((section) => ({
      ...section,
      categories: section.categories.map((category) => ({
        ...category,
        questions: category.questions.map((question) =>
          references.has(question.id) ? { ...question, references: references.get(question.id) } : question,
        ),
      })),
    })),
  };
}


function makeRow(
  entity: ExchangeEntity,
  input: {
    id: string;
    fields: ExchangeFields;
    parentId?: string | null;
    parentGroupId?: string | null;
    updatedAt?: Date | null;
    detail?: string | null;
  },
  scope: ExchangeScope = "account",
  owner: string | null = null,
): EntityRow {
  const fields = pickExchangeFields(entity, input.fields, scope);
  const parentGroupId = input.parentGroupId ?? null;
  return {
    id: input.id,
    key: naturalKey(entity, fields, parentGroupId, owner),
    hash: rowHash(entity, fields, parentGroupId, scope),
    updatedAt: input.updatedAt ?? null,
    name: typeof fields.name === "string" ? fields.name : "",
    detail: input.detail ?? null,
    fields,
    parentId: input.parentId ?? null,
    parentGroupId,
  };
}

/**
 * Строка обмена из сохранённых полей — снимка истории обмена или переноса
 * (серия D, Р5 и Р10): образец для `updateEntityRow`, когда запись
 * возвращают к прежним значениям. Поля берутся в составе `scope`.
 */
export function exchangeRowFromFields(
  entity: ExchangeEntity,
  input: { id: string; fields: ExchangeFields; parentId?: string | null },
  scope: ExchangeScope = "account",
): EntityRow {
  return makeRow(entity, { id: input.id, fields: input.fields, parentId: input.parentId ?? null }, scope);
}

/* ───────────────────────── чтение ───────────────────────── */

/**
 * Строки сущности у организации, старые раньше. Родитель переводится в
 * группу родителя по текущим связям (`parentGroupOf`). `scope` — состав
 * полей: в `foreign` у сотрудника читаются только ФИО и должность.
 * `owner` — аккаунт организации: в составе `foreign` он входит в ключ
 * сотрудника, и люди разных компаний по ФИО не сопоставляются.
 */
export async function loadEntityRows(
  entity: ExchangeEntity,
  organizationId: string,
  parentGroupOf: ParentGroupLookup = () => null,
  scope: ExchangeScope = "account",
  owner: string | null = null,
): Promise<EntityRow[]> {
  switch (entity) {
    case "position": {
      const rows = await db.jobPosition.findMany({
        where: { organizationId, categoryKey: STAFF_CATEGORY },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, name: true, updatedAt: true },
      });
      // Между аккаунтами (Р8.2) журналы должности из базы не читаются вовсе.
      const journals = scope === "foreign" ? null : await positionJournalCodes(organizationId, rows.map((row) => row.id));
      return rows.map((row) =>
        makeRow(
          entity,
          {
            id: row.id,
            fields: journals ? { name: row.name, journals: jsonList(journals.get(row.id) ?? []) } : { name: row.name },
            updatedAt: row.updatedAt,
          },
          scope,
        ),
      );
    }
    case "staff": {
      // Между аккаунтами (Р5) телефон и выходные из базы не читаются вовсе.
      const full = scope !== "foreign";
      const rows = await db.user.findMany({
        where: {
          organizationId,
          ...ORG_ROSTER_WHERE,
          passwordHash: "",
          jobPosition: { is: { categoryKey: STAFF_CATEGORY } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          phone: full,
          role: true,
          weeklyDaysOff: full,
          jobPositionId: true,
          jobPosition: { select: { name: true } },
        },
      });
      return rows
        .filter((row) => !isManagementRole(row.role))
        .map((row) =>
          makeRow(
            entity,
            {
              id: row.id,
              // Телефон сравниваем в едином виде: «8 (999)…» и «+7999…» — одно и то же,
              // а номер, который не разобрать, не считается сведением вовсе.
              fields: full
                ? { name: row.name, phone: normalizePhone(row.phone), weeklyDaysOff: normalizeWeeklyDaysOff(row.weeklyDaysOff) }
                : { name: row.name },
              parentId: row.jobPositionId,
              parentGroupId: row.jobPositionId ? parentGroupOf(row.jobPositionId) : null,
              detail: row.jobPosition?.name ?? null,
            },
            scope,
            // Внутри аккаунта ключ прежний — одно ФИО, одна запись.
            full ? null : owner,
          ),
        );
    }
    case "building": {
      const rows = await db.building.findMany({
        where: { organizationId, kind: { not: OFFICE_BUILDING_KIND } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, name: true, address: true, updatedAt: true },
      });
      return rows.map((row) =>
        makeRow(entity, {
          id: row.id,
          fields: { name: row.name, address: row.address },
          updatedAt: row.updatedAt,
          detail: text(row.address),
        }),
      );
    }
    case "room": {
      const rows = await db.room.findMany({
        where: { building: { organizationId, kind: { not: OFFICE_BUILDING_KIND } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          kind: true,
          sortOrder: true,
          ...ROOM_SCHEDULE_SELECT,
          buildingId: true,
          updatedAt: true,
          building: { select: { name: true } },
        },
      });
      return rows.map((row) =>
        makeRow(entity, {
          id: row.id,
          fields: { name: row.name, kind: row.kind, sortOrder: row.sortOrder, ...roomScheduleFields(row) },
          parentId: row.buildingId,
          parentGroupId: parentGroupOf(row.buildingId),
          updatedAt: row.updatedAt,
          detail: row.building.name,
        }),
      );
    }
    case "area": {
      const [rows, sole] = await Promise.all([
        db.area.findMany({
          where: { organizationId, ...NOT_OFFICE_AREA_WHERE },
          // У цеха нет даты создания; cuid растёт со временем.
          orderBy: { id: "asc" },
          select: { id: true, name: true, description: true, buildingId: true, building: { select: { name: true } } },
        }),
        soleObjectId(organizationId),
      ]);
      return rows.map((row) => {
        // Цех без объекта там, где объект один, — цех этого объекта: так он
        // находит «свой» цех у соседней организации, а не становится вторым.
        const buildingId = row.buildingId ?? sole;
        return makeRow(entity, {
          id: row.id,
          fields: { name: row.name, description: exchangedAreaDescription(row.description) },
          parentId: row.buildingId,
          parentGroupId: buildingId ? parentGroupOf(buildingId) : null,
          detail: row.building?.name ?? null,
        });
      });
    }
    case "equipment": {
      const rows = await db.equipment.findMany({
        where: { area: { organizationId, ...NOT_OFFICE_AREA_WHERE } },
        orderBy: { id: "asc" },
        select: {
          id: true,
          name: true,
          type: true,
          serialNumber: true,
          tempMin: true,
          tempMax: true,
          lampModel: true,
          lampLifetimeHours: true,
          areaId: true,
          area: { select: { name: true } },
        },
      });
      return rows.map((row) =>
        makeRow(entity, {
          id: row.id,
          fields: {
            name: row.name,
            type: row.type,
            serialNumber: row.serialNumber,
            tempMin: row.tempMin,
            tempMax: row.tempMax,
            lampModel: row.lampModel,
            lampLifetimeHours: row.lampLifetimeHours,
          },
          parentId: row.areaId,
          parentGroupId: parentGroupOf(row.areaId),
          detail: row.area.name,
        }),
      );
    }
    case "product": {
      const rows = await db.product.findMany({
        where: { organizationId, isActive: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          supplier: true,
          barcode: true,
          unit: true,
          category: true,
          kind: true,
          storageTemp: true,
          storageConditions: true,
          shelfLifeDays: true,
          shelfLifeHours: true,
          servingTemp: true,
          updatedAt: true,
        },
      });
      return rows.map(({ id, updatedAt, ...fields }) =>
        makeRow(entity, { id, fields, updatedAt, detail: text(fields.supplier) ?? text(fields.category) }),
      );
    }
    case "journal_settings": {
      // Точки со своим набором журналов: у такой организации выключено лишь то, что выключено на
      // всех её точках (disabled-journals.ts), — значение источника ей не записать, список «Журналы»
      // для неё не обменивается (серия C2).
      if (await hasOwnJournalPoints(organizationId)) return [];
      const organization = await db.organization.findUnique({
        where: { id: organizationId },
        select: { disabledJournalCodes: true, autoJournalCodes: true, journalAutomationJson: true, updatedAt: true },
      });
      if (!organization) return [];
      // Переключатели — без записи: `getJournalControls` сохранил бы выбор при первом чтении.
      const { controls, savedAt } = await peekJournalControls(organizationId);
      const updatedAt = savedAt && savedAt.getTime() > organization.updatedAt.getTime() ? savedAt : organization.updatedAt;
      return [makeRow(entity, { id: organizationId, fields: journalSettingsFields(organization, controls.automation), updatedAt })];
    }
    case "checklist_template": {
      const rows = await db.checklistTemplate.findMany({
        where: { organizationId, archived: false },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, title: true, definition: true, updatedAt: true },
      });
      return rows.map((row) => {
        const definition = checklistDefinition(row.definition);
        return makeRow(entity, {
          id: row.id,
          fields: { name: row.title, definition: definition ? canonicalJson(definition) : null },
          updatedAt: row.updatedAt,
        });
      });
    }
  }
}

/** У организации есть точки со своими настройками журналов — «Журналы» для неё не обмениваются. */
export async function hasOwnJournalPoints(organizationId: string): Promise<boolean> {
  return (await loadBuildingJournalSettings(db, organizationId)).size > 0;
}

/** Сколько записей списка у организации — для окна «Связать или перенести». */
export async function countExchangeRecords(organizationId: string): Promise<Record<ExchangeKind, number>> {
  const [products, staff, objects, equipment, checklists] = await Promise.all([
    db.product.count({ where: { organizationId, isActive: true } }),
    loadEntityRows("staff", organizationId).then((rows) => rows.length),
    db.building.count({ where: { organizationId, kind: { not: OFFICE_BUILDING_KIND } } }),
    db.equipment.count({ where: { area: { organizationId, ...NOT_OFFICE_AREA_WHERE } } }),
    db.checklistTemplate.count({ where: { organizationId, archived: false } }),
  ]);
  // Настройки журналов у организации всегда одни.
  return { products, staff, objects, equipment, journals: 1, checklists };
}

/* ───────────────────────── создание ───────────────────────── */

function productData(fields: ExchangeFields) {
  const kind = isProductKind(fields.kind) ? fields.kind : DEFAULT_PRODUCT_KIND;
  return {
    supplier: text(fields.supplier),
    barcode: text(fields.barcode),
    unit: text(fields.unit, 50) ?? "kg",
    category: text(fields.category),
    kind,
    storageTemp: text(fields.storageTemp, 100),
    storageConditions: text(fields.storageConditions, 500),
    shelfLifeDays: intOrNull(fields.shelfLifeDays),
    shelfLifeHours: intOrNull(fields.shelfLifeHours),
    servingTemp: kind === "finished" && isServingTemp(fields.servingTemp) ? fields.servingTemp : null,
  };
}

/**
 * Данные нового продукта по образцу — как у `createEntityRow("product", …)`;
 * пустое название — null (там это «занято»). Нужны пачке продуктов обмена
 * (`product-batch.server.ts`, серия E, Р3).
 */
export function productCreateData(organizationId: string, source: EntityRow) {
  const name = text(source.fields.name, 200);
  return name ? { ...productData(source.fields), name, organizationId } : null;
}

/**
 * Продукт с таким названием (без регистра) уже есть. При переименовании —
 * среди активных, как в `POST /api/products`; при создании (`anyState`) — и
 * среди выключенных: продукт, который организация убрала из справочника,
 * обмен обратно не заводит.
 */
async function productNameTaken(
  organizationId: string,
  name: string,
  options: { exceptId?: string; anyState?: boolean } = {},
): Promise<boolean> {
  const existing = await db.product.findFirst({
    where: {
      organizationId,
      name: { equals: name.trim(), mode: "insensitive" },
      ...(options.anyState ? {} : { isActive: true }),
      ...(options.exceptId ? { id: { not: options.exceptId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(existing);
}

/**
 * Человек с таким ФИО уже есть в организации — в любом виде: с входом,
 * руководитель, в архиве. Обмен видит только сотрудников без входа, и без
 * этой проверки завёл бы второго «Иванова» рядом с настоящим.
 */
async function personNameTaken(organizationId: string, name: string): Promise<boolean> {
  const existing = await db.user.findFirst({
    where: { organizationId, isRoot: false, name: { equals: name.trim(), mode: "insensitive" } },
    select: { id: true },
  });
  return Boolean(existing);
}

function equipmentData(fields: ExchangeFields) {
  return {
    type: text(fields.type, 50) ?? "other",
    serialNumber: text(fields.serialNumber, 100),
    tempMin: numberOrNull(fields.tempMin),
    tempMax: numberOrNull(fields.tempMax),
    lampModel: text(fields.lampModel, 120),
    lampLifetimeHours: intOrNull(fields.lampLifetimeHours),
  };
}

function roomKind(value: unknown): RoomKind {
  return (ROOM_KINDS as readonly string[]).includes(value as string) ? (value as RoomKind) : "other";
}

/**
 * Создать у организации запись по образцу. `parentId` — родитель уже в этой
 * организации (для цеха null — «единственный объект или без объекта»).
 *
 * `mirrorRoom: false` — новый цех не заводит помещение-зеркало. Так идёт
 * обмен, когда организация обменивается и объектами: помещения приходят
 * своим обменом, а зеркало вернулось бы соседям лишним помещением в журнале
 * уборки, которого они не заводили.
 *
 * `scope: "foreign"` — образец из другого аккаунта (Р5): сотрудник заводится
 * без телефона и выходных, что бы ни лежало в `source.fields`.
 */
export async function createEntityRow(
  entity: ExchangeEntity,
  organizationId: string,
  source: EntityRow,
  parentId: string | null,
  options: { mirrorRoom?: boolean; scope?: ExchangeScope } = {},
): Promise<CreateOutcome> {
  // Настройки журналов у организации есть всегда: создавать нечего (обмен
  // такие операции не применяет, перенос заменяет настройки — `updateEntityRow`).
  if (entity === "journal_settings") return { status: "conflict" };
  const name = text(source.fields.name, 200);
  if (!name) return { status: "conflict" };
  try {
    switch (entity) {
      case "position": {
        const last = await db.jobPosition.findFirst({
          where: { organizationId },
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true },
        });
        const created = await db.jobPosition.create({
          data: { organizationId, categoryKey: STAFF_CATEGORY, name: name.slice(0, 120), sortOrder: (last?.sortOrder ?? 0) + 1 },
          select: { id: true },
        });
        // Журналы — до сотрудников: `createStaffMember` выдаёт новым людям доступ по должности.
        if (options.scope !== "foreign") await syncPositionJournals(organizationId, created.id, source.fields.journals);
        return { status: "created", id: created.id };
      }
      case "staff": {
        // Только на должность категории staff: руководителей обмен не заводит.
        const position = parentId
          ? await db.jobPosition.findFirst({
              where: { id: parentId, organizationId, categoryKey: STAFF_CATEGORY },
              select: { id: true },
            })
          : null;
        if (!position) return { status: "conflict" };
        if (await personNameTaken(organizationId, name)) return { status: "conflict" };
        const full = options.scope !== "foreign";
        const input = {
          jobPositionId: position.id,
          fullName: name,
          phone: full ? text(source.fields.phone, 40) ?? undefined : undefined,
          weeklyDaysOff: full ? normalizeWeeklyDaysOff(source.fields.weeklyDaysOff) : undefined,
        };
        let result = await createStaffMember(organizationId, input);
        // Телефон в старом формате не должен оставлять человека без записи.
        if (!result.ok && result.status === 400 && input.phone) {
          result = await createStaffMember(organizationId, { ...input, phone: undefined });
        }
        if (result.ok) return { status: "created", id: result.user.id };
        return result.status === 402 ? { status: "limit" } : { status: "conflict" };
      }
      case "building": {
        const exists = await db.building.findFirst({ where: { organizationId, name }, select: { id: true } });
        if (exists) return { status: "conflict" };
        // Точки тарифа — как в POST /api/settings/buildings: первый объект
        // места не добавляет, каждый следующий — ещё одна точка.
        const buildingsNow = await db.building.count({ where: { organizationId, kind: { not: OFFICE_BUILDING_KIND } } });
        const points = await checkPointsForCreation(organizationId, buildingsNow > 0 ? 1 : 0, { source: EXCHANGE_SOURCE });
        if (!points.ok) return { status: "limit" };
        const created = await db.building.create({
          data: { organizationId, name: name.slice(0, 120), address: text(source.fields.address, 200), sortOrder: 0 },
          select: { id: true },
        });
        // С первым объектом открывается и офис (2026-11-24, офис у всех по умолчанию).
        await openOrganizationOffice(organizationId, { source: EXCHANGE_SOURCE }).catch((error) =>
          console.error("[directory-exchange] open office failed", error),
        );
        return { status: "created", id: created.id };
      }
      case "room": {
        const building = parentId
          ? await db.building.findFirst({
              where: { id: parentId, organizationId, kind: { not: OFFICE_BUILDING_KIND } },
              select: { id: true },
            })
          : null;
        if (!building) return { status: "conflict" };
        const roomName = name.slice(0, 120);
        const exists = await db.room.findFirst({ where: { buildingId: building.id, name: roomName }, select: { id: true } });
        if (exists) return { status: "conflict" };
        const { climateNorms: norms, ...schedule } = roomScheduleData(source.fields);
        const created = await db.room.create({
          data: {
            buildingId: building.id,
            name: roomName,
            kind: roomKind(source.fields.kind),
            sortOrder: intOrNull(source.fields.sortOrder) ?? 0,
            ...schedule,
            ...(norms ? { climateNorms: norms } : {}),
          },
          select: { id: true },
        });
        // Цех-зеркало — как в POST /api/settings/rooms (best-effort).
        const mirrorAreaId = await ensureRoomMirrorArea({
          organizationId,
          room: { id: created.id, name: roomName, buildingId: building.id },
        }).catch(() => undefined);
        // Своё зеркало — новый цех с id этого помещения в служебном описании; найденный одноимённый цех — не своё.
        const ownMirror = mirrorAreaId
          ? await db.area
              .findFirst({ where: { id: mirrorAreaId, organizationId, description: { contains: created.id } }, select: { id: true } })
              .catch(() => null)
          : null;
        // Пункты уборки из графика — как при правке карточки помещения (best-effort:
        // помещение уже есть, сбой пунктов не должен оставить его без связи).
        if (schedule.currentScope.length > 0 || schedule.generalScope.length > 0) {
          await syncRoomChecklistItems({
            organizationId,
            roomId: created.id,
            currentScope: scopeLabels(schedule.currentScope),
            generalScope: scopeLabels(schedule.generalScope),
          }).catch((error) => console.error("[directory-exchange] room checklist sync failed", error));
        }
        return { status: "created", id: created.id, ...(ownMirror ? { mirrorId: ownMirror.id } : {}) };
      }
      case "area": {
        // Объект образца у организации есть — цех его; иначе единственный
        // объект организации; иначе цех без объекта.
        const findObject = (id: string | null) =>
          id
            ? db.building.findFirst({
                where: { id, organizationId, kind: { not: OFFICE_BUILDING_KIND } },
                select: { id: true },
              })
            : null;
        const building = (await findObject(parentId)) ?? (await findObject(await soleObjectId(organizationId)));
        const created = await db.area.create({
          data: {
            name,
            description: text(source.fields.description, 1000),
            organizationId,
            buildingId: building?.id ?? null,
          },
          select: { id: true, name: true },
        });
        // Помещение-зеркало — как в POST /api/areas (best-effort).
        let mirrorRoomId: string | undefined;
        if (building && options.mirrorRoom !== false) {
          try {
            const sameRoom = await db.room.findFirst({
              where: { buildingId: building.id, name: { equals: created.name, mode: "insensitive" } },
              select: { id: true },
            });
            if (!sameRoom) {
              const mirror = await db.room.create({
                data: { buildingId: building.id, name: created.name.slice(0, 120), kind: guessRoomKind(created.name) },
                select: { id: true },
              });
              mirrorRoomId = mirror.id;
            }
          } catch (error) {
            console.error("[directory-exchange] area → room mirror failed", error);
          }
        }
        return { status: "created", id: created.id, ...(mirrorRoomId ? { mirrorId: mirrorRoomId } : {}) };
      }
      case "equipment": {
        const area = parentId
          ? await db.area.findFirst({ where: { id: parentId, organizationId }, select: { id: true } })
          : null;
        if (!area) return { status: "conflict" };
        // Датчик (`tuyaDeviceId`) и «кто заполняет» остаются у своей организации.
        const data = equipmentData(source.fields);
        const created = await db.equipment.create({ data: { ...data, name, areaId: area.id }, select: { id: true } });
        if (isFryerEquipmentType(data.type)) await syncFryerOilDocumentsSafe(organizationId);
        return { status: "created", id: created.id };
      }
      case "product": {
        if (await productNameTaken(organizationId, name, { anyState: true })) return { status: "conflict" };
        const created = await db.product.create({
          data: { ...productData(source.fields), name, organizationId },
          select: { id: true },
        });
        return { status: "created", id: created.id };
      }
      case "checklist_template": {
        // Как «Добавить типовой шаблон»: только проверенное содержание и без
        // второго живого шаблона с тем же названием; назначений и файлов нет.
        const definition = checklistDefinition(parseJson(source.fields.definition));
        if (!definition) return { status: "conflict" };
        return await db.$transaction(async (tx): Promise<CreateOutcome> => {
          const existing = await tx.checklistTemplate.findFirst({
            where: { organizationId, archived: false, title: { equals: name, mode: "insensitive" } },
            select: { id: true },
          });
          if (existing) return { status: "conflict" };
          const created = await tx.checklistTemplate.create({ data: { organizationId, title: name, definition }, select: { id: true } });
          return { status: "created", id: created.id };
        });
      }
    }
  } catch (error) {
    if (isUniqueConflict(error)) return { status: "conflict" };
    throw error;
  }
}

/* ───────────────────────── обновление ───────────────────────── */

/**
 * Норма температуры — в активные журналы холодильников организации, как
 * при правке карточки оборудования (`PUT /api/equipment/[id]`). Best-effort.
 */
async function syncColdEquipmentNorms(organizationId: string, equipmentId: string, min: number | null, max: number | null) {
  try {
    const documents = await db.journalDocument.findMany({
      where: { organizationId, status: "active", template: { code: COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE } },
      select: { id: true, config: true },
    });
    for (const document of documents) {
      const { config, changed } = applyEquipmentNormToColdConfig(normalizeColdEquipmentDocumentConfig(document.config), {
        sourceEquipmentId: equipmentId,
        min,
        max,
      });
      if (changed) await db.journalDocument.update({ where: { id: document.id }, data: { config } });
    }
  } catch (error) {
    console.error("[directory-exchange] cold norm sync failed", error);
  }
}

/**
 * Привести запись организации к образцу — только переносимые поля.
 * `parentId`: строка — новый родитель (должность, объект цеха, цех
 * оборудования), `undefined` — родителя не менять.
 *
 * `scope: "foreign"` — правка пришла в обмене между аккаунтами (Р5): у
 * сотрудника меняются только ФИО и должность, телефон и выходные остаются
 * такими, какими их ведёт сама организация.
 */
export async function updateEntityRow(
  entity: ExchangeEntity,
  organizationId: string,
  entityId: string,
  source: EntityRow,
  parentId?: string,
  options: { scope?: ExchangeScope } = {},
): Promise<UpdateOutcome> {
  if (entity === "journal_settings") return updateJournalSettings(organizationId, entityId, source);
  const name = text(source.fields.name, 200);
  if (!name) return { status: "conflict" };
  try {
    switch (entity) {
      case "position": {
        const updated = await db.jobPosition.updateMany({
          where: { id: entityId, organizationId, categoryKey: STAFF_CATEGORY },
          data: { name: name.slice(0, 120) },
        });
        if (updated.count === 0) return { status: "missing" };
        if (options.scope !== "foreign") await syncPositionJournals(organizationId, entityId, source.fields.journals);
        return { status: "updated" };
      }
      case "staff": {
        const current = await db.user.findFirst({
          where: { id: entityId, organizationId, ...ORG_ROSTER_WHERE, passwordHash: "" },
          select: { id: true, role: true, phone: true, positionTitle: true, jobPosition: { select: { name: true } } },
        });
        // Человеку дали вход или сделали руководителем — обмен его больше не правит.
        if (!current || isManagementRole(current.role)) return { status: "missing" };
        const position = parentId
          ? await db.jobPosition.findFirst({
              where: { id: parentId, organizationId, categoryKey: STAFF_CATEGORY },
              select: { id: true, name: true },
            })
          : null;
        const full = options.scope !== "foreign";
        const phone = full ? text(source.fields.phone, 40) : null;
        // Должность в подписи меняем, только если она повторяла прежнюю должность.
        const followsPosition = !current.positionTitle || current.positionTitle === current.jobPosition?.name;
        await db.user.update({
          where: { id: current.id },
          data: {
            name,
            // Пустой телефон образца — «сведений нет», а не «сотрите номер».
            ...(phone ? { phone } : {}),
            ...(full ? { weeklyDaysOff: normalizeWeeklyDaysOff(source.fields.weeklyDaysOff) } : {}),
            ...(position
              ? { jobPositionId: position.id, ...(followsPosition ? { positionTitle: position.name } : {}) }
              : {}),
          },
        });
        if (phone && phone !== current.phone) {
          tryAutolinkTasksflowByPhone({ organizationId, weSetupUserId: current.id, phone, name }).catch((error) => {
            console.error("[directory-exchange] tasksflow autolink failed", error);
          });
        }
        return { status: "updated" };
      }
      case "building": {
        const buildingName = name.slice(0, 120);
        const clash = await db.building.findFirst({
          where: { organizationId, name: buildingName, id: { not: entityId } },
          select: { id: true },
        });
        if (clash) return { status: "conflict" };
        const updated = await db.building.updateMany({
          where: { id: entityId, organizationId, kind: { not: OFFICE_BUILDING_KIND } },
          data: { name: buildingName, address: text(source.fields.address, 200) },
        });
        return updated.count > 0 ? { status: "updated" } : { status: "missing" };
      }
      case "room": {
        const current = await db.room.findFirst({
          where: { id: entityId, building: { organizationId, kind: { not: OFFICE_BUILDING_KIND } } },
          select: { id: true, name: true, buildingId: true, currentScope: true, generalScope: true },
        });
        if (!current) return { status: "missing" };
        const roomName = name.slice(0, 120);
        const clash = await db.room.findFirst({
          where: { buildingId: current.buildingId, name: roomName, id: { not: current.id } },
          select: { id: true },
        });
        if (clash) return { status: "conflict" };
        const { climateNorms: norms, ...schedule } = roomScheduleData(source.fields);
        // Пункты уборки пересобираются, когда изменился состав шагов, — до
        // правки помещения, как в PATCH /api/settings/rooms/[id]: сбой не
        // оставит помещение с новым графиком и старыми пунктами.
        const currentLabels = scopeLabels(schedule.currentScope);
        const generalLabels = scopeLabels(schedule.generalScope);
        const currentChanged = !sameList(scopeLabels(scopeSteps(current.currentScope)), currentLabels);
        const generalChanged = !sameList(scopeLabels(scopeSteps(current.generalScope)), generalLabels);
        if (currentChanged || generalChanged) {
          await syncRoomChecklistItems({
            organizationId,
            roomId: current.id,
            currentScope: currentChanged ? currentLabels : undefined,
            generalScope: generalChanged ? generalLabels : undefined,
          });
        }
        await db.room.update({
          where: { id: current.id },
          data: {
            name: roomName,
            kind: roomKind(source.fields.kind),
            sortOrder: intOrNull(source.fields.sortOrder) ?? 0,
            ...schedule,
            climateNorms: norms ?? Prisma.JsonNull,
          },
        });
        // Цех-зеркало переименовывается вместе с помещением — как в PATCH помещения.
        if (roomName !== current.name) {
          await renameRoomMirrorArea({
            organizationId,
            buildingId: current.buildingId,
            previousName: current.name,
            nextName: roomName,
          }).catch(() => undefined);
        }
        return { status: "updated" };
      }
      case "area": {
        const current = await db.area.findFirst({
          where: { id: entityId, organizationId },
          select: { id: true, description: true },
        });
        if (!current) return { status: "missing" };
        const description = text(source.fields.description, 1000);
        // Объект цеха обмен не меняет: цех остаётся там, где его завела организация.
        await db.area.update({
          where: { id: current.id },
          data: {
            name,
            // Служебное описание цеха-зеркала остаётся, пока образец не задал своё.
            ...(exchangedAreaDescription(current.description) !== description ? { description } : {}),
          },
        });
        return { status: "updated" };
      }
      case "equipment": {
        const current = await db.equipment.findFirst({
          where: { id: entityId, area: { organizationId } },
          select: { id: true, type: true, areaId: true, tempMin: true, tempMax: true },
        });
        if (!current) return { status: "missing" };
        const area = parentId
          ? await db.area.findFirst({ where: { id: parentId, organizationId }, select: { id: true } })
          : null;
        const data = equipmentData(source.fields);
        await db.equipment.update({
          where: { id: current.id },
          data: { ...data, name, ...(area ? { areaId: area.id } : {}) },
        });
        // Те же следствия, что у правки карточки: норма — в журналы
        // холодильников, фритюрница — в журнал фритюра, лампа — в журнал УФ.
        if ((current.tempMin !== data.tempMin || current.tempMax !== data.tempMax) && !isUvLampEquipment({ type: data.type, name })) {
          await syncColdEquipmentNorms(organizationId, current.id, data.tempMin, data.tempMax);
        }
        if (isFryerEquipmentType(current.type) || isFryerEquipmentType(data.type)) {
          await syncFryerOilDocumentsSafe(organizationId);
        }
        if (area && area.id !== current.areaId) {
          await syncUvDocumentPoints(organizationId).catch((error) => console.warn("[directory-exchange] uv points", error));
        }
        return { status: "updated" };
      }
      case "product": {
        if (await productNameTaken(organizationId, name, { exceptId: entityId })) return { status: "conflict" };
        const updated = await db.product.updateMany({
          where: { id: entityId, organizationId, isActive: true },
          data: { ...productData(source.fields), name },
        });
        return updated.count > 0 ? { status: "updated" } : { status: "missing" };
      }
      case "checklist_template": {
        const definition = checklistDefinition(parseJson(source.fields.definition));
        if (!definition) return { status: "conflict" };
        return await db.$transaction(async (tx): Promise<UpdateOutcome> => {
          const current = await tx.checklistTemplate.findFirst({
            where: { id: entityId, organizationId, archived: false },
            select: { id: true, definition: true },
          });
          if (!current) return { status: "missing" };
          const clash = await tx.checklistTemplate.findFirst({
            where: { organizationId, archived: false, title: { equals: name, mode: "insensitive" }, id: { not: current.id } },
            select: { id: true },
          });
          if (clash) return { status: "conflict" };
          // Версия растёт, как при правке в конструкторе: открытый там шаблон не перезапишет правку.
          await tx.checklistTemplate.update({
            where: { id: current.id },
            data: { title: name, definition: withOwnReferences(definition, current.definition), version: { increment: 1 } },
          });
          return { status: "updated" };
        });
      }
    }
  } catch (error) {
    if (isUniqueConflict(error)) return { status: "conflict" };
    throw error;
  }
}
