import { withNewHygieneFormVersion } from "@/lib/hygiene-v2";
import { db } from "@/lib/db";
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

/** Ростер для авто-подбора слотов (опционально — только выбранные должности). */
async function loadSlotRoster(
  organizationId: string,
  positionIds: string[]
): Promise<RosterUser[]> {
  const users = await db.user.findMany({
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
      jobPosition: { select: { name: true, categoryKey: true } },
    },
    orderBy: { name: "asc" },
  });
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
 */
async function fetchOrgDataForDefaults(
  organizationId: string
): Promise<DefaultConfigOrgData> {
  const [org, areas, rooms, equipment, users, products, supplierRows] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, isDemo: true },
    }),
    db.area.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // 2026-09-04: единый справочник помещений — климат и график
    // ген. уборок сидируются из Room (2026-09-22: вместе с графиком
    // генуборки — план сразу заполняется датами).
    db.room.findMany({
      where: { building: { organizationId } },
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
      where: { area: { organizationId } },
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
      where: { organizationId, ...ORG_ROSTER_WHERE },
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
 * + сохранение per-slot user assignments в Organization JSON-поле.
 *
 * Что делает:
 *   1. Сохраняет map { slotId → userId } в Organization.
 *      journalResponsibleUsersJson[code]. У каждого журнала своя
 *      схема слотов (см. journal-responsible-schemas.ts).
 *   2. Патчит CONFIG активных документов через per-journal patcher
 *      (см. journal-responsibles-doc-patchers.ts) — это куда уходят
 *      специфичные для журнала поля типа approveEmployeeId,
 *      cleaningResponsibles[], commission и т.д.
 *   3. Берёт PRIMARY-slot user и updateMany'ит на ВСЕХ активных
 *      документах этого журнала.responsibleUserId — это шапка
 *      printable-PDF и общий «ответственный по умолчанию».
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
}): Promise<{
  documentsUpdated: number;
  pickedPrimaryUserId: string | null;
  savedSlots: SlotUserMap;
}> {
  const { organizationId, templateId, journalCode, positionIds } = input;
  const scope: CascadeScope = input.scope ?? "active-today";
  const schema = getSchemaForJournal(journalCode);
  const primarySlotId = getPrimarySlotId(journalCode);
  const verifierSlotId = getVerifierSlotId(journalCode);
  const slotUsers: SlotUserMap = { ...(input.slotUsers ?? {}) };

  // 1. Авто-подбор по слотам, если ничего не задано.
  const usedUserIds = new Set<string>(
    Object.values(slotUsers).filter((v): v is string => Boolean(v))
  );

  const cascadeRoster = schema.slots.some((slot) => !slotUsers[slot.id])
    ? await loadSlotRoster(organizationId, positionIds)
    : [];
  for (const slot of schema.slots) {
    if (slotUsers[slot.id]) continue;
    // Общее правило ростера: подходящая должность → персонал/руководство
    // по типу слота; ROOT и аккаунты-заглушки — никогда не раньше людей.
    // Проверяющий может совпадать с исполнителем.
    const pick = rankRosterForSlot(
      cascadeRoster,
      { kind: rankKindForSlot(slot), positionKeywords: slot.positionKeywords },
      usedUserIds
    );
    if (pick) {
      slotUsers[slot.id] = pick.id;
      if (slot.kind !== "verifier") {
        usedUserIds.add(pick.id);
      }
    }
  }

  // 2. Сохраняем slot map в Organization.journalResponsibleUsersJson.
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { journalResponsibleUsersJson: true },
  });
  const allOrgSlots = (org?.journalResponsibleUsersJson ?? {}) as Record<
    string,
    SlotUserMap
  >;
  allOrgSlots[journalCode] = slotUsers;
  await db.organization.update({
    where: { id: organizationId },
    data: { journalResponsibleUsersJson: allOrgSlots as never },
  });

  // 3. Берём primary userId для responsibleUserId документа.
  const primaryUserId = slotUsers[primarySlotId] ?? null;

  if (!primaryUserId && !hasDocumentConfigPatcher(journalCode)) {
    return {
      documentsUpdated: 0,
      pickedPrimaryUserId: null,
      savedSlots: slotUsers,
    };
  }

  // Защита: проверяем что все попавшие в slots userId — реально из этой
  // орги. Иначе чисто отбрасываем.
  const userIdsToValidate = Object.values(slotUsers).filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
  let validUserIds = new Set<string>();
  if (userIdsToValidate.length > 0) {
    const owned = await db.user.findMany({
      where: {
        id: { in: userIdsToValidate },
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

    // Очищаем slotUsers от невалидных (мог быть архивный/из чужой орги
    // если кто-то прокинул из клиента).
    for (const [k, v] of Object.entries(slotUsers)) {
      if (v && !validUserIds.has(v)) slotUsers[k] = null;
    }

    // Patcher needs name+title — заведём lookup map.
    const userNameMap = new Map(owned.map((u) => [u.id, u.name] as const));
    const userPosMap = new Map(
      owned.map((u) => [u.id, getUserDisplayTitle(u)] as const)
    );

    // 4. Патчим document.config + ставим responsibleUserId.
    // Scope управляет какие документы попадают в каскад:
    //   • active-today — только active с покрытием сегодня (back-compat).
    //   • active-any   — все active.
    //   • all          — active + closed, любые периоды.
    // Last две опции используются когда менеджер хочет каскадно
    // переписать ответственного на старых документах (например,
    // уволили филлера → admin меняет старые записи на нового).
    const now = new Date();
    const todayUtcStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const docWhere: Record<string, unknown> = {
      organizationId,
      templateId,
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
      select: { id: true, config: true, _count: { select: { entries: true } } },
    });

    // Если есть пустые конфиги — нужны org-данные для enriched дефолта
    // (см. prefill ниже). Тянем один раз, переиспользуем для всех docs.
    const hasEmptyConfigs = docs.some((d) => {
      const cfg =
        d.config && typeof d.config === "object" && !Array.isArray(d.config)
          ? (d.config as Record<string, unknown>)
          : {};
      return Object.keys(cfg).length === 0 && d._count.entries === 0;
    });
    const cascadeOrgData = hasEmptyConfigs
      ? await fetchOrgDataForDefaults(organizationId)
      : undefined;

    let documentsUpdated = 0;
    for (const doc of docs) {
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
      const isEmpty =
        Object.keys(cfgObj).length === 0 && doc._count.entries === 0;
      const baseCfg = isEmpty
        ? getDefaultConfigForJournal(journalCode, cascadeOrgData)
        : cfgObj;

      const patched = hasDocumentConfigPatcher(journalCode)
        ? patchDocumentConfig(journalCode, baseCfg, slotUsers, {
            getName: (id) => (id ? userNameMap.get(id) ?? "" : ""),
            getPositionTitle: (id) => (id ? userPosMap.get(id) ?? "" : ""),
          })
        : null;

      const data: Record<string, unknown> = {};
      if (primaryUserId && validUserIds.has(primaryUserId)) {
        data.responsibleUserId = primaryUserId;
        // Также синхронизируем `responsibleTitle` (название должности
        // primary-сотрудника) — чтобы preview-карточка журнала на
        // /journals/<code> показывала «<position>: <name>», а не «—».
        // Без этого изменения в /settings/journal-responsibles обновляли
        // только userId — title оставался null/устаревший, и menager
        // видел «—» в preview.
        const primaryPosName = userPosMap.get(primaryUserId);
        if (primaryPosName) {
          data.responsibleTitle = primaryPosName;
        }
      }
      // Phase C: пишем verifierUserId если verifier-slot заполнен.
      // Если null — оставляем поле без change'а (legacy doc'и
      // продолжают работать через responsibleUserId fallback в
      // bulk-assign-today).
      const verifierUserId = slotUsers[verifierSlotId] ?? null;
      if (verifierUserId && validUserIds.has(verifierUserId)) {
        data.verifierUserId = verifierUserId;
      } else if (input.slotUsers && verifierSlotId in input.slotUsers) {
        // Юзер явно очистил verifier slot — пишем null чтобы убрать.
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

      await db.journalDocument.update({
        where: { id: doc.id },
        data,
      });
      documentsUpdated += 1;
    }

    return {
      documentsUpdated,
      pickedPrimaryUserId:
        primaryUserId && validUserIds.has(primaryUserId)
          ? primaryUserId
          : null,
      savedSlots: slotUsers,
    };
  }

  return {
    documentsUpdated: 0,
    pickedPrimaryUserId: null,
    savedSlots: slotUsers,
  };
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
  // приходилось вручную добавлять каждую строку.
  const orgData =
    input.baseConfig && Object.keys(input.baseConfig).length > 0
      ? undefined
      : await fetchOrgDataForDefaults(organizationId);
  const baseConfig =
    input.baseConfig && Object.keys(input.baseConfig).length > 0
      ? input.baseConfig
      : getDefaultConfigForJournal(journalCode, orgData);

  // 1. Читаем сохранённые слоты из Organization JSON.
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { journalResponsibleUsersJson: true, journalColumnsJson: true },
  });
  const allSlots = (org?.journalResponsibleUsersJson ?? {}) as Record<
    string,
    SlotUserMap
  >;
  const slots: SlotUserMap = { ...(allSlots[journalCode] ?? {}) };

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
  const prefillRoster = schema.slots.some((slot) => !slots[slot.id])
    ? await loadSlotRoster(organizationId, [])
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
  config = await withOrgCommission(input.organizationId, journalCode, config ?? {});

  // 6b. Бракеражи: меню и сырьё мастер-кабинета справочников пула
  // (src/lib/master-directory-push.ts). Слияние с памятью `shared*`, поэтому
  // повторный вызов для уже засеянного конфига ничего не дублирует. Нет
  // мастера в пуле — конфиг не меняется.
  config = await withMasterSharedLists(input.organizationId, journalCode, config ?? {});

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
