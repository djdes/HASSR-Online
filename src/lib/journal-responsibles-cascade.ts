import { withNewHygieneFormVersion } from "@/lib/hygiene-v2";
import { db } from "@/lib/db";
import { allowsImplicitJournalResponsible } from "@/lib/journal-controls";
import { parseOrgColumnDefaults, withOrgColumnDefault } from "@/lib/journal-columns";
import { withOrgCommission } from "@/lib/brakerage-commission-org";
import { withMasterSharedLists } from "@/lib/master-directory-push";
import {
  getPrimarySlotId,
  getSchemaForJournal,
  getVerifierSlotId,
  rankKindForSlot,
} from "@/lib/journal-responsible-schemas";
import {
  hasDocumentConfigPatcher,
  patchDocumentConfig,
} from "@/lib/journal-responsibles-doc-patchers";
import {
  type DefaultConfigOrgData,
  getDefaultConfigForJournal,
} from "@/lib/journal-default-configs";
import {
  ORG_ROSTER_WHERE,
  rankRosterForSlot,
  type RosterUser,
} from "@/lib/journal-roster";
import { getUserDisplayTitle } from "@/lib/user-roles";
import { documentRowsPointId, pointRowsWhere } from "@/lib/document-point-rows";
import { worksAtBuilding } from "@/lib/building-scope";
import { buildingTargets } from "@/lib/building-targets";
import {
  droppedSlotIds,
  loadEffectiveResponsibleSlots,
  parseSlotMaps,
  resolvePointSlots,
  savePointJournalSlots,
  type SlotMaps,
} from "@/lib/journal-responsibles-points";

/** Точка авто-подбора: её id и точки организации (висящие id удалённых точек не режут людей). */
type RosterPoint = { id: string; orgBuildingIds: readonly string[] } | null;

/**
 * Ростер для авто-подбора слотов (опционально — только выбранные должности).
 * Для точки — только её сотрудники и те, кто работает на всех точках
 * (2026-10-31, ответственные по точкам).
 */
async function loadSlotRoster(
  organizationId: string,
  positionIds: string[],
  point: RosterPoint = null,
): Promise<RosterUser[]> {
  const all = await db.user.findMany({
    where: {
      organizationId,
      ...ORG_ROSTER_WHERE,
      ...(positionIds.length > 0 ? { jobPositionId: { in: positionIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      positionTitle: true,
      buildingIds: true,
      jobPosition: { select: { name: true, categoryKey: true } },
    },
    orderBy: { name: "asc" },
  });
  const users = point ? all.filter((user) => worksAtBuilding(point.orgBuildingIds, user.buildingIds ?? [], point.id)) : all;
  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    positionTitle: user.positionTitle,
    jobPositionName: user.jobPosition?.name ?? null,
    jobPositionCategory: user.jobPosition?.categoryKey ?? null,
  }));
}

/**
 * Подтягивает org-данные (areas + equipment + users + products) для
 * enriched-дефолтов журналов. Используется prefill/cascade чтобы при
 * создании или backfill'е документа таблица сразу содержала реальные
 * цеха/оборудование/продукты, а не stub'ы.
 *
 * Документ точки — справочники только этой точки (2026-10-29: «в журналы
 * конкретной точки выводятся все помещения / сотрудники / оборудование
 * организации»), см. `pointRowsWhere`.
 */
async function fetchOrgDataForDefaults(
  organizationId: string,
  buildingId?: string | null,
): Promise<DefaultConfigOrgData> {
  const rows = pointRowsWhere(await documentRowsPointId(organizationId, buildingId));
  const [org, areas, rooms, equipment, users, products, supplierRows] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, isDemo: true },
    }),
    db.area.findMany({
      where: { organizationId, AND: [rows.area] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // 2026-09-04: единый справочник помещений — климат и график
    // ген. уборок сидируются из Room (2026-09-22: вместе с графиком
    // генуборки — план сразу заполняется датами).
    db.room.findMany({
      where: { building: { organizationId }, AND: [rows.room] },
      select: {
        id: true,
        name: true,
        climateNorms: true,
        generalScheduleType: true,
        generalDays: true,
        generalMonthDays: true,
      },
      orderBy: [{ buildingId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    db.equipment.findMany({
      where: { area: { organizationId }, AND: [rows.equipment] },
      select: {
        id: true,
        name: true,
        type: true,
        tempMin: true,
        tempMax: true,
      },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      // ORG_ROSTER_WHERE сам занимает `AND` — точку кладём рядом, а не поверх.
      where: { AND: [{ organizationId, ...ORG_ROSTER_WHERE }, rows.staff] },
      // Должность нужна, чтобы бланк печатался с «Иванова · Повар», а не
      // с одним ФИО: иначе человеку всё равно приходится вписывать её
      // рукой в каждую строку.
      select: {
        id: true,
        name: true,
        role: true,
        positionTitle: true,
        jobPosition: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.product.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // Поставщики из принятых партий — справочник для бракеража
    // скоропорта вместо демо-«ИП Бубнов».
    db.batch.findMany({
      where: { organizationId, supplier: { not: null } },
      select: { supplier: true },
      orderBy: { supplier: "asc" },
      distinct: ["supplier"],
      take: 100,
    }),
  ]);
  return {
    areas,
    rooms,
    equipment,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      positionTitle: u.positionTitle,
      jobPositionName: u.jobPosition?.name ?? null,
    })),
    products,
    suppliers: supplierRows
      .map((row) => row.supplier?.trim() ?? "")
      .filter((supplier) => supplier.length > 0),
    organizationName: org?.name ?? undefined,
    isDemo: org?.isDemo === true,
  };
}

/**
 * Каскад изменений «ответственных за журнал» в реальные JournalDocument'ы
 * + сохранение per-slot user assignments.
 *
 * Что делает:
 *   1. Сохраняет map { slotId → userId }: без точки — в
 *      Organization.journalResponsibleUsersJson[code], с точкой — в
 *      Building.journalResponsibleUsersJson[code] («ответственные по
 *      точкам», 2026-10-31). У каждого журнала своя схема слотов (см.
 *      journal-responsible-schemas.ts).
 *   2. Патчит CONFIG документов через per-journal patcher
 *      (см. journal-responsibles-doc-patchers.ts) — это куда уходят
 *      специфичные для журнала поля типа approveEmployeeId,
 *      cleaningResponsibles[], commission и т.д.
 *   3. Ставит responsibleUserId / verifierUserId документам.
 * Люди для каждого документа — действующие ответственные его точки
 * (`resolvePointSlots`): своё точки или организации, но только те, кто
 * работает на точке; пустой слот точки — авто-подбор из её сотрудников.
 * Сохранение точки трогает только её документы.
 *
 * Если конкретные ФИО не переданы (slots = пустой объект) — для
 * каждого слота подбираем подходящего сотрудника по schema.keywords,
 * без дубликатов между слотами одного журнала.
 */

export type SlotUserMap = Record<string, string | null>;

export type CascadeScope =
  /** Только активный документ покрывающий сегодня (legacy default). */
  | "active-today"
  /** Все active документы независимо от периода. */
  | "active-any"
  /** Все документы — active И closed, любые периоды. Используется
   *  когда менеджер изменил ответственного и хочет переписать
   *  историю задним числом. UI требует подтверждение. */
  | "all";

/** Авто-подбор пустых слотов из ростера (без дублей среди исполнителей). */
function autoPickSlots(journalCode: string, slotUsers: SlotUserMap, roster: RosterUser[]): SlotUserMap {
  const schema = getSchemaForJournal(journalCode);
  const next: SlotUserMap = { ...slotUsers };
  const usedUserIds = new Set<string>(Object.values(next).filter((v): v is string => Boolean(v)));
  for (const slot of schema.slots) {
    if (next[slot.id]) continue;
    // Общее правило ростера: подходящая должность → персонал/руководство
    // по типу слота; ROOT и аккаунты-заглушки — никогда не раньше людей.
    // Проверяющий может совпадать с исполнителем.
    const pick = rankRosterForSlot(
      roster,
      { kind: rankKindForSlot(slot), positionKeywords: slot.positionKeywords },
      usedUserIds
    );
    if (pick) {
      next[slot.id] = pick.id;
      if (slot.kind !== "verifier") usedUserIds.add(pick.id);
    }
  }
  return next;
}

function needsAutoPick(journalCode: string, slotUsers: SlotUserMap): boolean {
  return allowsImplicitJournalResponsible(journalCode) && getSchemaForJournal(journalCode).slots.some((slot) => !slotUsers[slot.id]);
}

export async function cascadeResponsibleToActiveDocuments(input: {
  organizationId: string;
  templateId: string;
  journalCode: string;
  positionIds: string[];
  /** Карта slotId → userId. Если не передана — авто-подбор. */
  slotUsers?: SlotUserMap;
  /** Какие документы каскадировать. По умолчанию active-today
   *  (back-compat). UI с двумя кнопками передаёт active-any для
   *  «изменить в активных» и all для «изменить во всех». */
  scope?: CascadeScope;
  /**
   * Ответственные точки (2026-10-31): карта сохраняется в точке, каскад —
   * только документы этой точки. Не точка организации (точки выключены) —
   * как без неё: организация.
   */
  buildingId?: string | null;
}): Promise<{
  documentsUpdated: number;
  pickedPrimaryUserId: string | null;
  savedSlots: SlotUserMap;
}> {
  const { organizationId, templateId, journalCode, positionIds } = input;
  const scope: CascadeScope = input.scope ?? "active-today";
  const primarySlotId = getPrimarySlotId(journalCode);
  const targets = await buildingTargets(organizationId);
  const orgBuildingIds = targets.filter((id): id is string => id !== null);
  const pointId = input.buildingId && orgBuildingIds.includes(input.buildingId) ? input.buildingId : null;

  // 1. Авто-подбор по слотам, если ничего не задано: у точки — из её людей.
  let slotUsers: SlotUserMap = { ...(input.slotUsers ?? {}) };
  if (needsAutoPick(journalCode, slotUsers)) {
    const roster = await loadSlotRoster(organizationId, positionIds, pointId ? { id: pointId, orgBuildingIds } : null);
    slotUsers = autoPickSlots(journalCode, slotUsers, roster);
  }

  // 2. Чистим от невалидных (архивный / из чужой орги, если кто-то
  // прокинул из клиента) и сохраняем: точка — в Building, иначе — в
  // Organization.
  const ids = Object.values(slotUsers).filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ids.length > 0) {
    const owned = await db.user.findMany({
      where: { id: { in: ids }, organizationId, ...ORG_ROSTER_WHERE },
      select: { id: true },
    });
    const valid = new Set(owned.map((u) => u.id));
    for (const [k, v] of Object.entries(slotUsers)) {
      if (v && !valid.has(v)) slotUsers[k] = null;
    }
  }
  if (pointId) {
    await savePointJournalSlots(organizationId, pointId, journalCode, slotUsers);
  } else {
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { journalResponsibleUsersJson: true },
    });
    const allOrgSlots = (org?.journalResponsibleUsersJson ?? {}) as Record<string, SlotUserMap>;
    allOrgSlots[journalCode] = slotUsers;
    await db.organization.update({
      where: { id: organizationId },
      data: { journalResponsibleUsersJson: allOrgSlots as never },
    });
  }

  // 3. Документы — по действующим ответственным их точки.
  const documentsUpdated = await applyResponsiblesToDocuments({
    organizationId,
    templateId,
    journalCode,
    positionIds,
    scope,
    onlyBuildingId: pointId,
    explicitSlotIds: new Set(Object.keys(input.slotUsers ?? {})),
  });

  const primaryUserId = slotUsers[primarySlotId] ?? null;
  return {
    documentsUpdated,
    pickedPrimaryUserId: primaryUserId,
    savedSlots: slotUsers,
  };
}

/**
 * Проставить документам журнала действующих ответственных их точки (без
 * сохранения карт). `onlyBuildingId` — только документы этой точки
 * («Вернуть как у организации» на точке, сохранение точки).
 */
export async function applyResponsiblesToDocuments(input: {
  organizationId: string;
  templateId: string;
  journalCode: string;
  positionIds: string[];
  scope: CascadeScope;
  onlyBuildingId?: string | null;
  /** Слоты, которые человек явно трогал: пустой проверяющий из них — стереть. */
  explicitSlotIds?: Set<string>;
}): Promise<number> {
  const { organizationId, templateId, journalCode, positionIds, scope } = input;
  const primarySlotId = getPrimarySlotId(journalCode);
  const verifierSlotId = getVerifierSlotId(journalCode);

  // Scope управляет какие документы попадают в каскад:
  //   • active-today — только active с покрытием сегодня (back-compat).
  //   • active-any   — все active.
  //   • all          — active + closed, любые периоды.
  // Last две опции используются когда менеджер хочет каскадно
  // переписать ответственного на старых документах (например,
  // уволили филлера → admin меняет старые записи на нового).
  const now = new Date();
  const todayUtcStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const docWhere: Record<string, unknown> = {
    organizationId,
    templateId,
    ...(input.onlyBuildingId ? { buildingId: input.onlyBuildingId } : {}),
  };
  if (scope === "active-today") {
    docWhere.status = "active";
    docWhere.dateFrom = { lte: todayUtcStart };
    docWhere.dateTo = { gte: todayUtcStart };
  } else if (scope === "active-any") {
    docWhere.status = "active";
  }
  // scope === "all" — без дополнительных where-клозов.
  const docs = await db.journalDocument.findMany({
    where: docWhere,
    select: { id: true, config: true, buildingId: true, _count: { select: { entries: true } } },
  });
  if (docs.length === 0) return 0;

  // Карты ответственных: организация и точки (свои по журналу).
  const [org, buildings, targets] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { journalResponsibleUsersJson: true } }),
    db.building.findMany({ where: { organizationId }, select: { id: true, journalResponsibleUsersJson: true } }),
    buildingTargets(organizationId),
  ]);
  const orgSlots = parseSlotMaps(org?.journalResponsibleUsersJson);
  const pointSlotsById = new Map(
    buildings
      .filter((b) => b.journalResponsibleUsersJson != null)
      .map((b) => [b.id, parseSlotMaps(b.journalResponsibleUsersJson)] as const),
  );
  const orgBuildingIds = targets.filter((id): id is string => id !== null);

  // Люди из карт — с их точками; ростер точки — для авто-подбора.
  const mentioned = new Set<string>();
  const addMap = (map: SlotMaps) => {
    for (const userId of Object.values(map[journalCode] ?? {})) if (userId) mentioned.add(userId);
  };
  addMap(orgSlots);
  for (const map of pointSlotsById.values()) addMap(map);
  const mentionedUsers = mentioned.size
    ? await db.user.findMany({ where: { id: { in: [...mentioned] }, organizationId }, select: { id: true, buildingIds: true } })
    : [];
  const pointsByUser = new Map(mentionedUsers.map((u) => [u.id, u.buildingIds ?? []]));

  // Ответственные для документов одной точки (null — организация как есть).
  const slotsByGroup = new Map<string, { slots: SlotUserMap; dropped: string[] }>();
  const slotsFor = async (buildingId: string | null) => {
    const key = buildingId ?? "";
    const cached = slotsByGroup.get(key);
    if (cached) return cached;
    let result: { slots: SlotUserMap; dropped: string[] };
    if (!buildingId || !orgBuildingIds.includes(buildingId)) {
      result = { slots: { ...(orgSlots[journalCode] ?? {}) }, dropped: [] };
    } else {
      const pointSlots = pointSlotsById.get(buildingId) ?? null;
      const resolved = resolvePointSlots({
        orgSlots: { [journalCode]: orgSlots[journalCode] ?? {} },
        pointSlots: pointSlots && Object.hasOwn(pointSlots, journalCode) ? { [journalCode]: pointSlots[journalCode] } : null,
        worksAtPoint: (userId) => {
          const ids = pointsByUser.get(userId);
          return !ids || worksAtBuilding(orgBuildingIds, ids, buildingId);
        },
      });
      const source = resolved.ownCodes.has(journalCode) ? pointSlots?.[journalCode] : orgSlots[journalCode];
      let slots = resolved.slots[journalCode] ?? {};
      // Пустые слоты точки — из её сотрудников (человек другой точки в
      // документ точки не попадает).
      if (needsAutoPick(journalCode, slots)) {
        const roster = await loadSlotRoster(organizationId, positionIds, { id: buildingId, orgBuildingIds });
        slots = autoPickSlots(journalCode, slots, roster);
      }
      result = { slots, dropped: droppedSlotIds(source, slots) };
    }
    slotsByGroup.set(key, result);
    return result;
  };

  const groups = await Promise.all([...new Set(docs.map((doc) => doc.buildingId ?? null))].map((id) => slotsFor(id)));
  const allIds = new Set<string>();
  for (const group of groups) for (const v of Object.values(group.slots)) if (v) allIds.add(v);
  if (allIds.size === 0 && !hasDocumentConfigPatcher(journalCode)) return 0;
  const owned = allIds.size
    ? await db.user.findMany({
        where: { id: { in: [...allIds] }, organizationId, ...ORG_ROSTER_WHERE },
        select: { id: true, name: true, role: true, positionTitle: true, jobPosition: { select: { name: true } } },
      })
    : [];
  const validUserIds = new Set(owned.map((u) => u.id));
  // Patcher needs name+title — заведём lookup map.
  const userNameMap = new Map(owned.map((u) => [u.id, u.name] as const));
  const userPosMap = new Map(owned.map((u) => [u.id, getUserDisplayTitle(u)] as const));

  // Пустым конфигам нужны org-данные для enriched дефолта (см. prefill
  // ниже) — по точке документа, один запрос на точку.
  const orgDataByPoint = new Map<string, Promise<DefaultConfigOrgData>>();
  const cascadeOrgDataFor = (buildingId: string | null) => {
    const key = buildingId ?? "";
    let data = orgDataByPoint.get(key);
    if (!data) {
      data = fetchOrgDataForDefaults(organizationId, buildingId);
      orgDataByPoint.set(key, data);
    }
    return data;
  };

  let documentsUpdated = 0;
  for (const doc of docs) {
    const group = await slotsFor(doc.buildingId ?? null);
    const slotUsers: SlotUserMap = {};
    for (const [k, v] of Object.entries(group.slots)) slotUsers[k] = v && validUserIds.has(v) ? v : null;
    const primaryUserId = slotUsers[primarySlotId] ?? null;
    if (!primaryUserId && !hasDocumentConfigPatcher(journalCode)) continue;

    // Если существующий config пустой ({}), подменяем дефолтным от
    // соответствующей default-функции, чтобы у документа появились
    // строки/зоны/оборудование. Это backfill для документов,
    // созданных ДО prefill-фикса. Не трогаем конфиги где уже есть
    // данные — иначе затрём пользовательские правки.
    const cfgObj =
      doc.config && typeof doc.config === "object" && !Array.isArray(doc.config)
        ? (doc.config as Record<string, unknown>)
        : {};
    // Документ с записями, но пустым конфигом, не «досеиваем»: его уже
    // вели, и подсунутые строки дефолта перемешались бы с реальными
    // данными. Такому документу только проставляем людей.
    const isEmpty = Object.keys(cfgObj).length === 0 && doc._count.entries === 0;
    const baseCfg = isEmpty
      ? getDefaultConfigForJournal(journalCode, await cascadeOrgDataFor(doc.buildingId))
      : cfgObj;

    const patched = hasDocumentConfigPatcher(journalCode)
      ? patchDocumentConfig(journalCode, baseCfg, slotUsers, {
          getName: (id) => (id ? userNameMap.get(id) ?? "" : ""),
          getPositionTitle: (id) => (id ? userPosMap.get(id) ?? "" : ""),
        })
      : null;

    const data: Record<string, unknown> = {};
    if (primaryUserId) {
      data.responsibleUserId = primaryUserId;
      // Также синхронизируем `responsibleTitle` (название должности
      // primary-сотрудника) — чтобы preview-карточка журнала на
      // /journals/<code> показывала «<position>: <name>», а не «—».
      const primaryPosName = userPosMap.get(primaryUserId);
      if (primaryPosName) data.responsibleTitle = primaryPosName;
    }
    // Phase C: пишем verifierUserId если verifier-slot заполнен.
    // Пусто — стираем, только если человек явно очистил слот или
    // проверяющий организации на этой точке не работает (иначе legacy
    // doc'и продолжают работать через responsibleUserId fallback в
    // bulk-assign-today).
    const verifierUserId = slotUsers[verifierSlotId] ?? null;
    if (verifierUserId) {
      data.verifierUserId = verifierUserId;
    } else if (input.explicitSlotIds?.has(verifierSlotId) || group.dropped.includes(verifierSlotId)) {
      data.verifierUserId = null;
    }
    if (patched) {
      data.config = patched as never;
    } else if (isEmpty && Object.keys(baseCfg).length > 0) {
      // Patcher отсутствует, но дефолт для журнала есть — записываем
      // его, чтобы документ перестал быть пустым.
      data.config = baseCfg as never;
    }
    if (Object.keys(data).length === 0) continue;

    await db.journalDocument.update({ where: { id: doc.id }, data });
    documentsUpdated += 1;
  }
  return documentsUpdated;
}

/**
 * «Как у организации» на точке: убрать своих ответственных точки по журналу и
 * проставить её активным документам действующих (организации, кто работает на
 * точке, остальное — авто-подбор из её сотрудников).
 */
export async function resetPointResponsibles(input: {
  organizationId: string;
  templateId: string;
  journalCode: string;
  buildingId: string;
  positionIds: string[];
}): Promise<{ documentsUpdated: number; slots: SlotUserMap }> {
  await savePointJournalSlots(input.organizationId, input.buildingId, input.journalCode, null);
  const documentsUpdated = await applyResponsiblesToDocuments({
    organizationId: input.organizationId,
    templateId: input.templateId,
    journalCode: input.journalCode,
    positionIds: input.positionIds,
    scope: "active-any",
    onlyBuildingId: input.buildingId,
  });
  const effective = await loadEffectiveResponsibleSlots(input.organizationId, input.buildingId);
  return { documentsUpdated, slots: { ...(effective.slots[input.journalCode] ?? {}) } };
}

/**
 * Используется при СОЗДАНИИ нового JournalDocument'а (auto-create cron,
 * bulk-assign фан-аут, ручное создание на /journals/[code]). Подтягивает
 * сохранённых в /settings/journal-responsibles слот-юзеров и патчит
 * config + возвращает primary userId.
 *
 * Не пишет в БД — caller сам кладёт результат в `data` для create.
 *
 * Использование:
 *   const filled = await prefillResponsiblesForNewDocument({
 *     organizationId, journalCode, baseConfig
 *   });
 *   await db.journalDocument.create({
 *     data: {
 *       ...,
 *       config: filled.config,
 *       responsibleUserId: filled.responsibleUserId,
 *     },
 *   });
 */
export async function prefillResponsiblesForNewDocument(input: {
  organizationId: string;
  journalCode: string;
  baseConfig?: Record<string, unknown>;
  /**
   * Явно выбранные автоматикой люди (модалка включения автосоздания,
   * политика `journalAutomationJson[code].responsibles.mode = "custom"`).
   * Кладутся ПОВЕРХ сохранённых в /settings/journal-responsibles слотов,
   * дальше идёт штатный путь: валидация «жив и из этой орги», авто-подбор
   * незаполненных слотов и patchDocumentConfig — печатные формы получают
   * имена и должности без отдельного кода.
   */
  slotOverrides?: SlotUserMap;
  /**
   * Флаги колонок (`showX`) в `baseConfig` выбрал человек в диалоге создания
   * — они важнее общего набора колонок организации для своих колонок.
   */
  respectColumnFlags?: boolean;
  /** Точка нового документа: её комиссия и мастер-кабинет её пула. */
  buildingId?: string | null;
}): Promise<{
  config: Record<string, unknown>;
  responsibleUserId: string | null;
  /** Phase C: verifier для нового документа. Caller передаёт в
   *  JournalDocument.verifierUserId при db.create. */
  verifierUserId: string | null;
}> {
  const { organizationId, journalCode } = input;
  // Если caller передал baseConfig — уважаем его. Иначе берём дефолт
  // для журнала: для cleaning — массивы responsibles, для climate —
  // точки контроля, для general_cleaning — список помещений и т.д.
  // Без этого многие документы создавались с {} → bulk-assign-today
  // потом сообщал «у журнала нет строк для назначения».
  //
  // Подтягиваем реальные areas/equipment/products орги, чтобы для
  // climate появились rooms по цехам, для cold-equipment — все
  // холодильники, для glass-list — оборудование/продукты, для
  // equipment-calibration — список оборудования. Без этого при
  // создании нового документа таблица была пустой и менеджеру
  // приходилось вручную добавлять каждую строку. Документ точки — её
  // холодильники, помещения и люди (2026-10-29).
  const orgData =
    input.baseConfig && Object.keys(input.baseConfig).length > 0
      ? undefined
      : await fetchOrgDataForDefaults(organizationId, input.buildingId);
  const baseConfig =
    input.baseConfig && Object.keys(input.baseConfig).length > 0
      ? input.baseConfig
      : getDefaultConfigForJournal(journalCode, orgData);

  // 1. Сохранённые слоты: у документа точки — действующие ответственные
  // точки (своё точки или организации, кто работает на точке), 2026-10-31.
  const [org, effective] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { journalColumnsJson: true },
    }),
    loadEffectiveResponsibleSlots(organizationId, input.buildingId),
  ]);
  const slots: SlotUserMap = { ...(effective.slots[journalCode] ?? {}) };
  const rosterPoint: RosterPoint = effective.pointId
    ? { id: effective.pointId, orgBuildingIds: (await buildingTargets(organizationId)).filter((id): id is string => id !== null) }
    : null;

  // 1b. Выбор автоматики важнее сохранённых слотов. Пустые значения
  // игнорируем: «не выбрано» в модалке значит «оставить как есть», а не
  // «очистить слот».
  for (const [slotId, userId] of Object.entries(input.slotOverrides ?? {})) {
    if (userId) slots[slotId] = userId;
  }

  // 2. Если в orgSlots ничего нет — попробуем подобрать на лету через
  // schema.keywords по активным сотрудникам с подходящими должностями.
  // (Стандартная ситуация: новая орга, ещё не заходила в settings.)
  const schema = getSchemaForJournal(journalCode);
  const usedIds = new Set<string>(
    Object.values(slots).filter((v): v is string => Boolean(v))
  );
  const prefillRoster = allowsImplicitJournalResponsible(journalCode) && schema.slots.some((slot) => !slots[slot.id])
    ? await loadSlotRoster(organizationId, [], rosterPoint)
    : [];
  for (const slot of schema.slots) {
    if (slots[slot.id]) continue;
    // C3 аудита журналов: если по ключевым словам должности не нашёлся
    // НИКТО (у сотрудников ещё не проставлен jobPosition), берём остальной
    // ростер — иначе бланк уходил инспектору без ФИО. Но не «по алфавиту»:
    // исполнитель — сначала линейный персонал, проверяющий — сначала
    // руководство; ROOT и аккаунт «имя = почта» не выбираются, пока есть
    // живые сотрудники. Проверяющий может совпадать с исполнителем.
    const pick = rankRosterForSlot(
      prefillRoster,
      { kind: rankKindForSlot(slot), positionKeywords: slot.positionKeywords },
      usedIds
    );
    if (pick) {
      slots[slot.id] = pick.id;
      // Не добавляем в usedIds для verifier — это позволяет другим
      // verifier-слотам других журналов матчить того же юзера.
      if (slot.kind !== "verifier") {
        usedIds.add(pick.id);
      }
    }
  }

  const primarySlotId = getPrimarySlotId(journalCode);
  const verifierSlotId = getVerifierSlotId(journalCode);
  const primaryUserId = slots[primarySlotId] ?? null;
  const verifierRawUserId = slots[verifierSlotId] ?? null;

  // 3. Валидация — оставляем только реально-существующих в орге.
  const userIdsToCheck = Object.values(slots).filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
  let validUserIds = new Set<string>();
  let userNameMap = new Map<string, string>();
  let userPosMap = new Map<string, string>();
  if (userIdsToCheck.length > 0) {
    const owned = await db.user.findMany({
      where: {
        id: { in: userIdsToCheck },
        organizationId,
        ...ORG_ROSTER_WHERE,
      },
      select: {
        id: true,
        name: true,
        role: true,
        positionTitle: true,
        jobPosition: { select: { name: true } },
      },
    });
    validUserIds = new Set(owned.map((u) => u.id));
    userNameMap = new Map(owned.map((u) => [u.id, u.name] as const));
    // Должность — как в карточке сотрудника: jobPosition → positionTitle →
    // название роли. Её же печатает шапка («УТВЕРЖДАЮ», «Ответственный»).
    userPosMap = new Map(
      owned.map((u) => [u.id, getUserDisplayTitle(u)] as const)
    );
    for (const [k, v] of Object.entries(slots)) {
      if (v && !validUserIds.has(v)) slots[k] = null;
    }
  }

  // 4. Патчим config через journal-specific patcher.
  let config = baseConfig;
  if (hasDocumentConfigPatcher(journalCode)) {
    const patched = patchDocumentConfig(journalCode, baseConfig, slots, {
      getName: (id) => (id ? userNameMap.get(id) ?? "" : ""),
      getPositionTitle: (id) => (id ? userPosMap.get(id) ?? "" : ""),
    });
    if (patched) config = patched;
  }

  // 5. Общий набор колонок организации — новому документу (модель «копия»:
  // набор ложится в config.columns и флаги showX, печать и TasksFlow читают
  // их из документа). Свой набор в конфиге (перенос из прошлого документа)
  // не трогаем.
  config =
    withOrgColumnDefault(journalCode, config, parseOrgColumnDefaults(org?.journalColumnsJson), {
      respectFlags: input.respectColumnFlags === true,
    }) ?? config;

  // 6. Бракеражи: состав комиссии организации — новому документу
  // (окно «Сторонняя бракеражная комиссия», модель «копия»).
  config = await withOrgCommission(input.organizationId, journalCode, config ?? {}, input.buildingId);

  // 6b. Бракеражи: меню и сырьё мастер-кабинета справочников пула
  // (src/lib/master-directory-push.ts). Слияние с памятью `shared*`, поэтому
  // повторный вызов для уже засеянного конфига ничего не дублирует. Нет
  // мастера в пуле — конфиг не меняется.
  config = await withMasterSharedLists(input.organizationId, journalCode, config ?? {}, input.buildingId);

  // 7. Гигиена: новый документ — по форме Приложения №1 СанПиН
  // (config.hygieneFormVersion = 2), в т.ч. когда конфиг перенесён из
  // прошлого периода. Вызов для СУЩЕСТВУЮЩЕГО документа (close-day)
  // возвращает версию обратно через keepHygieneFormVersion.
  config = withNewHygieneFormVersion(journalCode, config ?? {});

  return {
    config,
    responsibleUserId:
      primaryUserId && validUserIds.has(primaryUserId) ? primaryUserId : null,
    verifierUserId:
      verifierRawUserId && validUserIds.has(verifierRawUserId)
        ? verifierRawUserId
        : null,
  };
}
