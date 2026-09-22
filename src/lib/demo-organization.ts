import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  ALL_JOURNAL_CODES,
  computeAutoJournalCodes,
  computeDisabledJournalCodes,
  getOnboardingPreset,
} from "@/lib/onboarding-presets";
import { normalizeSphere, sphereToPreset } from "@/lib/org-profile";
import { paperJournalsFor } from "@/lib/sphere-journal-rules";
import { createOrganization } from "@/lib/create-organization";
import {
  DEMO_ORG_TTL_DAYS,
  demoExpiresAtFrom,
  demoOrgName,
} from "@/lib/demo-organization.shared";
import { getDemoRoster, type DemoPerson } from "@/lib/demo-organization-roster";
import {
  buildDemoJournalSeed,
  buildPaperJournalRows,
  paperJournalInstructor,
  type DemoJournalContext,
} from "@/lib/demo-organization-journals";
import { ensureActiveDocument } from "@/lib/journal-auto-create";
import { buildJournalDocumentTitle } from "@/lib/journal-document-title";
import { hasResponsibleColumn, hasVerifierColumn } from "@/lib/paper-journal-columns";
import {
  buildDateKeys,
  toDateKey,
  type HealthEntryData,
  type HygieneEntryData,
} from "@/lib/hygiene-document";
import {
  buildColdEquipmentAutoFillEntryData,
  normalizeColdEquipmentDocumentConfig,
} from "@/lib/cold-equipment-document";
import {
  buildClimateAutoFillEntryData,
  climateCorrectionKey,
  normalizeClimateDocumentConfig,
} from "@/lib/climate-document";
import {
  buildUvRuntimeAutoFillEntryData,
  normalizeUvRuntimeDocumentConfig,
} from "@/lib/uv-lamp-runtime-document";
import {
  DEFAULT_EQUIPMENT_TYPES,
  DEFAULT_FAT_TYPES,
  DEFAULT_QUALITY_PHRASES,
  type FryerOilEntryData,
} from "@/lib/fryer-oil-document";
import {
  normalizeCleaningVentilationConfig,
  type CleaningVentilationChecklistEntryData,
} from "@/lib/cleaning-ventilation-checklist-document";
import {
  CLEANING_SIGNATURE_ROW_ID,
  CONTROL_SIGNATURE_ROW_ID,
  applyRoomScheduleToMatrix,
  fillPastDaysNotPerformed,
  markAutoSignature,
  normalizeCleaningDocumentConfig,
  setCleaningMatrixValue,
  toRoomScheduleMap,
} from "@/lib/cleaning-document";
import {
  createIntensiveCoolingRow,
  normalizeIntensiveCoolingConfig,
} from "@/lib/intensive-cooling-document";
import {
  SANITATION_MONTHS,
  createEmptySanitationRow,
  normalizeSanitationDayConfig,
} from "@/lib/sanitation-day-document";
import {
  createEmptyConsumption,
  createEmptyReceipt,
  normalizeDisinfectantConfig,
} from "@/lib/disinfectant-document";

export {
  DEMO_ORG_TTL_DAYS,
  demoDaysLeft,
  demoExpiresAtFrom,
  demoOrgName,
} from "@/lib/demo-organization.shared";

/**
 * Демо-организация — песочница «как это выглядит, когда уже работает».
 *
 * Два входа с одним заселением:
 *   • ROOT: `POST /api/root/seed-demo-org` — своя org + owner-пользователь,
 *     живёт пока ROOT не удалит.
 *   • Владелец аккаунта: «Создать демо-организацию» в анкете после
 *     регистрации и в меню профиля (`POST /api/organizations/demo`) —
 *     вторая организация того же аккаунта с `isDemo=true`, удаляется по
 *     кнопке или cron'ом `purge-demo-orgs` через DEMO_ORG_TTL_DAYS.
 *
 * Что внутри (см. `demo-organization-roster.ts`):
 *   • команда с настоящими ФИО и разными должностями — управляющий,
 *     технолог, повара, зал, уборщик, кладовщик; у каждого свои выходные;
 *   • здание с помещениями и цеха с холодильниками — журналы собираются
 *     из них тем же `ensureActiveDocument`, что и ночной cron, поэтому
 *     документы ничем не отличаются от «настоящих»;
 *   • записи за последние N дней включая сегодня, и не «всё зелёное»:
 *     больничный, отпуск, холодильник +8,5 °C, жара в цехе, прогоркшее
 *     масло — с корректирующими действиями и комментариями, как их
 *     пишет живой технолог.
 *
 * Демо-сотрудники в тарифе не считаются (см. plan-limits.server.ts).
 * Чистые helper'ы (имя, срок, дни) — в demo-organization.shared.ts, их
 * импортируют и клиентские компоненты.
 */

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** 0=Пн … 6=Вс для ключа YYYY-MM-DD — та же шкала, что `User.weeklyDaysOff`. */
function mondayIndex(dateKey: string): number {
  return (new Date(`${dateKey}T00:00:00Z`).getUTCDay() + 6) % 7;
}

const MONTH_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function dayMonthGenitive(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${Number(day)} ${MONTH_GENITIVE[Number(month) - 1]}`;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

type SeededPerson = DemoPerson & { id: string };

type EntryRow = Prisma.JournalDocumentEntryCreateManyInput;

export type SeedDemoResult = {
  positionsCreated: number;
  staffCreated: number;
  documentsCreated: number;
  entriesCreated: number;
};

/**
 * Заселяет УЖЕ созданную организацию: должности с доступом к журналам,
 * команда из ростера, здание/помещения/цеха/холодильники, документы
 * ежедневных журналов через `ensureActiveDocument` и записи за последние
 * `daysOfHistory` дней (включая сегодня) с отклонениями.
 *
 * Организация должна быть свежей: должности и люди создаются без
 * проверки на дубли, записи вставляются пачками.
 */
export async function seedDemoOrganizationData(input: {
  organizationId: string;
  /** Сфера или legacy-тип — прогоняется через sphereToPreset(). */
  sphere: string;
  /** Кто «создал» документы. */
  createdById: string;
  /** Дополнительные люди в гигиеническом ростере (ROOT добавляет своего owner'а). */
  extraEmployees?: Array<{ id: string; name: string }>;
  daysOfHistory?: number;
}): Promise<SeedDemoResult> {
  const orgId = input.organizationId;
  const orgType = sphereToPreset(input.sphere);
  const preset = getOnboardingPreset(orgType);
  const roster = getDemoRoster(orgType);
  const days = Math.max(2, input.daysOfHistory ?? DEMO_ORG_TTL_DAYS);
  const emailSlug = `demo-${orgId.slice(-8).toLowerCase()}`;

  const now = new Date();
  const today = utcDayStart(now);
  const todayKey = toDateKey(today);
  const windowStart = addUtcDays(today, -(days - 1));
  const windowKeys = buildDateKeys(windowStart, today);
  /** Ключ дня «k дней назад» (0 = сегодня); undefined если окно короче. */
  const ago = (k: number): string | undefined => windowKeys[windowKeys.length - 1 - k];
  const pastKeys = windowKeys.slice(0, -1);
  /**
   * Наступил ли момент `dateKey HH:MM` (см. `DemoJournalContext.happened`).
   * Демо не пишет факт вперёд: сегодняшняя строка появляется, только
   * если её время уже прошло.
   */
  const happened = (dateKey: string, timeHm?: string): boolean => {
    if (!dateKey) return false;
    if (dateKey < todayKey) return true;
    if (dateKey > todayKey) return false;
    if (!timeHm) return true;
    const [h, m] = timeHm.split(":").map(Number);
    if (!Number.isFinite(h)) return true;
    const minutes = h * 60 + (Number.isFinite(m) ? m : 0);
    return minutes <= now.getHours() * 60 + now.getMinutes();
  };

  // 1. Должности — только те, что заняты в ростере. Пустые должности в
  // демо лишь шумят в /settings/users и в выборе ответственных.
  const positionNames = Array.from(new Set(roster.people.map((p) => p.position)));
  const templates = await db.journalTemplate.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
  });
  const tplByCode = new Map(templates.map((t) => [t.code, t.id]));
  const positionByName = new Map<string, string>();
  let sortOrder = 0;
  for (const name of positionNames) {
    const presetPosition = preset.positions.find((p) => p.name === name);
    const created = await db.jobPosition.create({
      data: {
        organizationId: orgId,
        categoryKey: presetPosition?.category ?? "staff",
        name,
        sortOrder: sortOrder++,
      },
      select: { id: true },
    });
    positionByName.set(name, created.id);
    const journalCodes = presetPosition?.journalCodes ?? ["hygiene", "health_check"];
    const templateIds = journalCodes
      .map((code) => tplByCode.get(code))
      .filter((id): id is string => Boolean(id));
    if (templateIds.length === 0) continue;
    await db.jobPositionJournalAccess.createMany({
      data: templateIds.map((templateId) => ({
        organizationId: orgId,
        jobPositionId: positionByName.get(name)!,
        templateId,
      })),
      skipDuplicates: true,
    });
  }

  // 2. Команда. Активные — иначе не попадут ни в ростер журналов, ни в
  // список команды; в тарифе они не считаются по флагу isDemo.
  const people: SeededPerson[] = [];
  for (const person of roster.people) {
    const created = await db.user.create({
      data: {
        organizationId: orgId,
        name: person.name,
        email: `${emailSlug}-${person.phone.replace(/\D/g, "")}@wesetup.local`,
        passwordHash: "",
        role: person.role,
        phone: person.phone,
        positionTitle: person.position,
        jobPositionId: positionByName.get(person.position) ?? null,
        weeklyDaysOff: person.weeklyDaysOff,
        isActive: true,
      },
      select: { id: true },
    });
    people.push({ ...person, id: created.id });
  }
  const manager = people.find((p) => p.role === "manager") ?? people[0];
  const technologist =
    people.find((p) => p.position === "Технолог") ??
    people.find((p) => p.role === "head_chef") ??
    manager;
  const cleaner = people.find((p) => p.position === "Уборщик") ?? people[people.length - 1];
  const chef = people.find((p) => p.role === "head_chef") ?? technologist;
  // Роли для «редких» журналов. В сферах без поваров/кладовщиков
  // (пекарня, производство) — любой линейный сотрудник, лишь бы не тот же
  // человек: unique (документ, сотрудник, день) не пустит две записи.
  const lineStaff = people.filter((p) => p.role === "cook" && p.id !== cleaner.id);
  const cook =
    people.find((p) => /^Повар/.test(p.position) && p.role === "cook") ?? lineStaff[0] ?? chef;
  const storekeeper =
    people.find((p) => p.position === "Кладовщик") ??
    lineStaff.find((p) => p.id !== cook.id) ??
    technologist;
  const dishwasher =
    people.find((p) => p.position === "Посудомойщик") ??
    lineStaff.find((p) => p.id !== cook.id && p.id !== storekeeper.id) ??
    cleaner;

  // 3. Здание, помещения, цеха и холодильники — ДО документов: журнал
  // уборки строится из Room, холодильный — из Equipment, климат — из Area.
  const building = await db.building.create({
    data: { organizationId: orgId, name: "Основное здание", sortOrder: 0 },
    select: { id: true },
  });
  for (const [index, room] of roster.rooms.entries()) {
    await db.room.create({
      data: {
        buildingId: building.id,
        name: room.name,
        kind: room.kind,
        sortOrder: index,
        detergent: room.detergent,
        currentScope: json(room.currentScope),
        generalScope: json(room.generalScope),
        currentDays: room.currentDays,
        generalDays: room.generalDays,
      },
    });
  }
  for (const area of roster.areas) {
    await db.area.create({
      data: {
        organizationId: orgId,
        name: area.name,
        equipment: {
          create: area.equipment.map((item) => ({
            name: item.name,
            type: item.type,
            tempMin: item.tempMin,
            tempMax: item.tempMax,
          })),
        },
      },
    });
  }

  // 4. Документы — тем же путём, что ночной cron. Период документа обычно
  // начинается 1-го или 16-го; если окно истории длиннее — сдвигаем
  // начало, чтобы прошлые дни были внутри документа, а не «до него».
  const absences = planAbsences(people, windowKeys);
  const organization = await db.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });
  const organizationName = organization?.name ?? demoOrgName(input.sphere);
  // Все журналы пресета, не только ежедневные: демо показывает, как
  // выглядят приёмка, бракераж, аудиты и акты «в работе». Порядок — как
  // в ALL_JOURNAL_CODES, чтобы /journals читался сверху вниз.
  const disabled = new Set(computeDisabledJournalCodes(preset));
  const presetCodes = new Set(preset.positions.flatMap((p) => p.journalCodes));
  const enabledCodes = ALL_JOURNAL_CODES.filter(
    (code) => presetCodes.has(code) && !disabled.has(code),
  );
  let documentsCreated = 0;
  let entriesCreated = 0;
  for (const code of enabledCodes) {
    const report = await ensureActiveDocument(db, {
      organizationId: orgId,
      templateCode: code,
      now,
      autoFill: true,
    });
    if (!report.documentId) continue;
    documentsCreated += 1;

    const doc = await db.journalDocument.findUnique({
      where: { id: report.documentId },
      select: {
        id: true,
        config: true,
        dateFrom: true,
        dateTo: true,
        responsibleUserId: true,
        template: { select: { name: true } },
      },
    });
    if (!doc) continue;

    const docUpdate: Prisma.JournalDocumentUpdateInput = {};
    if (doc.dateFrom > windowStart) {
      docUpdate.dateFrom = windowStart;
      docUpdate.title = `${doc.template.name} · с ${dayMonthGenitive(
        toDateKey(windowStart),
      )} по ${dayMonthGenitive(toDateKey(doc.dateTo))}`;
    }
    const responsible =
      people.find((p) => p.id === doc.responsibleUserId) ?? technologist;

    let rows: EntryRow[] | null = null;
    let config: unknown = undefined;
    switch (code) {
      case "hygiene":
        rows = buildHygieneRows(doc.id, windowKeys, absences, input.extraEmployees ?? []);
        break;
      case "health_check":
        rows = buildHealthRows(doc.id, windowKeys, absences, input.extraEmployees ?? []);
        break;
      case "cold_equipment_control":
        rows = buildColdEquipmentRows(doc.id, doc.config, windowKeys, responsible, ago);
        break;
      case "climate_control":
        rows = buildClimateRows(doc.id, doc.config, windowKeys, responsible, ago);
        break;
      case "fryer_oil":
        rows = buildFryerRows(doc.id, windowKeys, chef, cook, ago);
        break;
      // Два журнала намеренно без сегодняшней записи — чтобы на /journals
      // было видно, как выглядит «ещё не заполнено», а не только зелёное.
      case "cleaning_ventilation_checklist":
        rows = buildVentilationRows(doc.id, doc.config, pastKeys, people, cleaner);
        break;
      case "uv_lamp_runtime":
        rows = buildUvRows(doc.id, doc.config, pastKeys, responsible);
        break;
      case "cleaning":
        config = await buildCleaningConfig(orgId, doc.config, windowKeys, todayKey, ago);
        break;
      case "intensive_cooling":
        config = buildIntensiveCoolingConfig(doc.config, windowKeys, people, chef, roster.dishes, ago);
        break;
      case "general_cleaning":
        config = buildSanitationConfig(doc.config, today, roster.rooms.map((r) => r.name), manager, cleaner);
        break;
      case "disinfectant_usage":
        config = buildDisinfectantConfig(doc.config, windowKeys, technologist);
        break;
      default: {
        const seed = buildDemoJournalSeed(code, {
          documentId: doc.id,
          rawConfig: doc.config,
          docDateFrom: doc.dateFrom,
          windowKeys,
          todayKey,
          ago,
          happened,
          people,
          manager,
          technologist,
          chef,
          cleaner,
          cook,
          storekeeper,
          dishwasher,
          roster,
          organizationName,
        } satisfies DemoJournalContext);
        if (seed?.rows) rows = seed.rows;
        if (seed?.config !== undefined) config = seed.config;
        break;
      }
    }

    if (rows) {
      // Автосев `ensureActiveDocument` уже положил «пустые» строки на
      // период — заменяем их целиком, иначе unique (doc, employee, date)
      // отбросит наши.
      await db.journalDocumentEntry.deleteMany({ where: { documentId: doc.id } });
      if (rows.length > 0) {
        const result = await db.journalDocumentEntry.createMany({
          data: rows,
          skipDuplicates: true,
        });
        entriesCreated += result.count;
      }
    }
    if (config !== undefined) docUpdate.config = json(config);
    if (Object.keys(docUpdate).length > 0) {
      await db.journalDocument.update({ where: { id: doc.id }, data: docUpdate });
    }
  }

  // 5. Бумажные журналы сферы (инструктажи, огнетушители) — по одному
  // активному документу с заполненными строками, подписи пустые: их
  // ставят ручкой, электронная копия — для сроков и печати.
  const paperCtx = { people, manager, technologist, chef, todayKey, ago, roster };
  // Документ — на текущий месяц, как его заводит модалка на странице журнала.
  const [demoYear, demoMonth] = todayKey.split("-").map(Number);
  const monthFrom = `${todayKey.slice(0, 7)}-01`;
  const monthTo = `${todayKey.slice(0, 7)}-${String(
    new Date(Date.UTC(demoYear, demoMonth, 0)).getUTCDate(),
  ).padStart(2, "0")}`;
  for (const journal of paperJournalsFor(normalizeSphere(input.sphere))) {
    await db.paperJournalDocument.create({
      data: {
        organizationId: orgId,
        journalId: journal.id,
        title: buildJournalDocumentTitle({
          journalName: journal.name,
          dateFrom: monthFrom,
          dateTo: monthTo,
        }),
        rows: json(buildPaperJournalRows(journal, paperCtx)),
        dateFrom: new Date(`${monthFrom}T00:00:00.000Z`),
        dateTo: new Date(`${monthTo}T00:00:00.000Z`),
        responsible: hasResponsibleColumn(journal)
          ? paperJournalInstructor(journal, paperCtx).name
          : null,
        verifier: hasVerifierColumn(journal)
          ? paperJournalInstructor(journal, paperCtx).name
          : null,
        createdById: input.createdById,
      },
    });
    documentsCreated += 1;
  }

  return {
    positionsCreated: positionByName.size,
    staffCreated: people.length,
    documentsCreated,
    entriesCreated,
  };
}

// ────────────────────────────────────────────────────────────────────
// Гигиена и осмотр: выходные по правилу, один больничный, один отпуск.
// ────────────────────────────────────────────────────────────────────

type Absence = "day_off" | "vacation" | "suspended" | "sick_leave";

type AbsencePlan = {
  people: SeededPerson[];
  /** personId → dateKey → причина отсутствия. */
  byPerson: Map<string, Map<string, Absence>>;
  feverPersonId: string | null;
};

function planAbsences(people: SeededPerson[], windowKeys: string[]): AbsencePlan {
  const byPerson = new Map<string, Map<string, Absence>>();
  for (const person of people) {
    const map = new Map<string, Absence>();
    for (const key of windowKeys) {
      if (person.weeklyDaysOff.includes(mondayIndex(key))) map.set(key, "day_off");
    }
    byPerson.set(person.id, map);
  }

  // Больничный: линейный сотрудник с температурой на осмотре три дня
  // назад — отстранён, два дня болел, сегодня снова на смене.
  const sick = people.find((p) => p.role === "cook");
  const sickKeys = windowKeys.slice(-4, -1);
  if (sick && sickKeys.length === 3) {
    const map = byPerson.get(sick.id)!;
    map.set(sickKeys[0], "suspended");
    map.set(sickKeys[1], "sick_leave");
    map.set(sickKeys[2], "sick_leave");
  }

  // Отпуск: кто-то из зала на всё окно — так выглядит «Отп» в сетке.
  const onVacation =
    [...people].reverse().find((p) => p.role === "waiter" && p.id !== sick?.id) ??
    [...people].reverse().find((p) => p.role !== "manager" && p.id !== sick?.id);
  if (onVacation) {
    const map = byPerson.get(onVacation.id)!;
    for (const key of windowKeys) map.set(key, "vacation");
  }

  return { people, byPerson, feverPersonId: sick?.id ?? null };
}

function buildHygieneRows(
  documentId: string,
  windowKeys: string[],
  plan: AbsencePlan,
  extra: Array<{ id: string; name: string }>,
): EntryRow[] {
  const rows: EntryRow[] = [];
  const everyone = [...extra.map((e) => e.id), ...plan.people.map((p) => p.id)];
  for (const employeeId of everyone) {
    const absences = plan.byPerson.get(employeeId);
    for (const key of windowKeys) {
      const absence = absences?.get(key);
      const data: HygieneEntryData = absence
        ? { status: absence, temperatureAbove37: absence === "suspended" }
        : { status: "healthy", temperatureAbove37: false };
      rows.push({ documentId, employeeId, date: new Date(key), data: json(data) });
    }
  }
  return rows;
}

function buildHealthRows(
  documentId: string,
  windowKeys: string[],
  plan: AbsencePlan,
  extra: Array<{ id: string; name: string }>,
): EntryRow[] {
  const rows: EntryRow[] = [];
  const everyone = [...extra.map((e) => e.id), ...plan.people.map((p) => p.id)];
  for (const employeeId of everyone) {
    const absences = plan.byPerson.get(employeeId);
    for (const key of windowKeys) {
      const absence = absences?.get(key);
      if (absence === "suspended") {
        const data: HealthEntryData = {
          signed: false,
          measures:
            "Температура 37,4 °C, жалобы на слабость — отстранён от работы, направлен в поликлинику",
        };
        rows.push({ documentId, employeeId, date: new Date(key), data: json(data) });
        continue;
      }
      if (absence) continue;
      const data: HealthEntryData = { signed: true, measures: null };
      rows.push({ documentId, employeeId, date: new Date(key), data: json(data) });
    }
  }
  return rows;
}

// ────────────────────────────────────────────────────────────────────
// Журналы «одна строка в день» с отклонениями.
// ────────────────────────────────────────────────────────────────────

function buildColdEquipmentRows(
  documentId: string,
  rawConfig: unknown,
  windowKeys: string[],
  responsible: SeededPerson,
  ago: (k: number) => string | undefined,
): EntryRow[] {
  const config = normalizeColdEquipmentDocumentConfig(rawConfig);
  if (config.equipment.length === 0) return [];
  const fridge =
    config.equipment.find((item) => item.min != null && item.min >= 0) ?? config.equipment[0];
  const freezer = config.equipment.find((item) => item.max != null && item.max < 0);
  const rows: EntryRow[] = [];
  for (const dateKey of windowKeys) {
    const data = buildColdEquipmentAutoFillEntryData({
      config,
      dateKey,
      responsibleTitle: responsible.name,
    });
    if (dateKey === ago(2)) {
      data.temperatures[fridge.id] = Math.round(((fridge.max ?? 4) + 4.5) * 10) / 10;
      data.corrections = {
        ...data.corrections,
        [fridge.id]:
          "Дверца неплотно закрыта после приёмки товара. Уплотнитель проверен, продукты осмотрены — без признаков порчи. Повторный замер через 2 часа: +3,5 °C.",
      };
    }
    if (freezer && dateKey === ago(1)) {
      data.temperatures[freezer.id] = -14;
      data.corrections = {
        ...data.corrections,
        [freezer.id]:
          "Плановая разморозка. Продукты на время переложены в соседний ларь. После включения −19 °C, вызов мастера не потребовался.",
      };
    }
    rows.push({ documentId, employeeId: responsible.id, date: new Date(dateKey), data: json(data) });
  }
  return rows;
}

function buildClimateRows(
  documentId: string,
  rawConfig: unknown,
  windowKeys: string[],
  responsible: SeededPerson,
  ago: (k: number) => string | undefined,
): EntryRow[] {
  const config = normalizeClimateDocumentConfig(rawConfig);
  if (config.rooms.length === 0 || config.controlTimes.length === 0) return [];
  const hotRoom = config.rooms[0];
  const lastTime = config.controlTimes[config.controlTimes.length - 1];
  const humidRoom = config.rooms[1] ?? config.rooms[0];
  const firstTime = config.controlTimes[0];
  const rows: EntryRow[] = [];
  for (const dateKey of windowKeys) {
    const data = buildClimateAutoFillEntryData({
      config,
      dateKey,
      responsibleTitle: responsible.name,
    });
    if (dateKey === ago(3) && hotRoom.temperature.enabled && hotRoom.temperature.max != null) {
      data.measurements[hotRoom.id][lastTime].temperature = hotRoom.temperature.max + 2.5;
      data.corrections = {
        ...data.corrections,
        [climateCorrectionKey(hotRoom.id, lastTime, "temperature")]:
          "Жара на улице, кондиционер не справлялся. Приточную вентиляцию включили на максимум, к вечеру +24 °C.",
      };
    }
    if (dateKey === ago(5) && humidRoom.humidity.enabled && humidRoom.humidity.max != null) {
      data.measurements[humidRoom.id][firstTime].humidity = humidRoom.humidity.max + 6;
      data.corrections = {
        ...data.corrections,
        [climateCorrectionKey(humidRoom.id, firstTime, "humidity")]:
          "После влажной уборки. Проветрили 20 минут, повторный замер — 62 %.",
      };
    }
    rows.push({ documentId, employeeId: responsible.id, date: new Date(dateKey), data: json(data) });
  }
  return rows;
}

/**
 * Фритюр: две фритюрницы, у каждой своя жизнь масла. №1 (шеф) — на
 * пальмовом, масло служит ~4 дня и меняется по горькому привкусу;
 * №2 (повар) — на подсолнечном под картофель фри, меняется через день.
 * Сегодня обе фритюрницы запущены, но смена ещё идёт — конец дня пуст.
 * Unique (документ, сотрудник, день) — поэтому за каждой фритюрницей
 * закреплён свой человек.
 */
function buildFryerRows(
  documentId: string,
  windowKeys: string[],
  chef: SeededPerson,
  cook: SeededPerson,
  ago: (k: number) => string | undefined,
): EntryRow[] {
  const rows: EntryRow[] = [];
  const todayKey = ago(0);
  const [good, lightColor, amber, weakTaste, bitter] = DEFAULT_QUALITY_PHRASES;
  const fryers: Array<{
    equipment: string;
    person: SeededPerson;
    fat: string;
    products: string[];
    /** Через сколько дней масло меняют; последний день цикла — «к утилизации». */
    cycleDays: number;
    loadKg: number;
    startHour: number;
    endHour: number;
  }> = [
    {
      equipment: DEFAULT_EQUIPMENT_TYPES[0],
      person: chef,
      fat: DEFAULT_FAT_TYPES[1],
      products: ["Куриные крылышки", "Наггетсы", "Креветки в кляре", "Луковые кольца"],
      cycleDays: 4,
      loadKg: 10,
      startHour: 10,
      endHour: 22,
    },
    {
      equipment: DEFAULT_EQUIPMENT_TYPES[1],
      person: cook === chef ? chef : cook,
      fat: DEFAULT_FAT_TYPES[0],
      products: ["Картофель фри", "Сырные палочки", "Картофель фри"],
      cycleDays: 2,
      loadKg: 8,
      startHour: 11,
      endHour: 23,
    },
  ];
  // Обе фритюрницы на одном человеке (сфера без поваров) — вторую не
  // ведём, иначе unique-ключ отбросит половину строк.
  const active = fryers[0].person.id === fryers[1].person.id ? fryers.slice(0, 1) : fryers;

  for (const fryer of active) {
    windowKeys.forEach((dateKey, index) => {
      const dayInCycle = index % fryer.cycleDays; // 0 — свежее масло
      const lastDay = dayInCycle === fryer.cycleDays - 1;
      const isToday = dateKey === todayKey;
      const fresh = dayInCycle === 0;
      const qualityStart = fresh ? 5 : dayInCycle === 1 ? 4 : 3;
      const qualityEnd = lastDay ? 2 : dayInCycle === 0 ? 4 : 3;
      // Переходящий остаток — что осталось со вчера: продукт уносит
      // ~1,5 кг в день. В день свежей закладки остатка нет, в последний
      // день цикла остаток сливается целиком.
      const carryoverKg = fresh ? 0 : fryer.loadKg - 1.5 * dayInCycle;
      const disposedKg = lastDay ? Math.max(carryoverKg - 1.5, 1) : 0;
      const data: FryerOilEntryData = {
        startDate: dateKey,
        startHour: fryer.startHour,
        startMinute: fresh ? 0 : 30,
        fatType: fryer.fat,
        qualityStart,
        qualityStartNote: fresh
          ? `${good}. Залито свежее, ${fryer.loadKg} кг`
          : dayInCycle === 1
            ? lightColor
            : weakTaste,
        equipmentType: fryer.equipment,
        productType: fryer.products[index % fryer.products.length],
        endHour: isToday ? null : fryer.endHour,
        endMinute: isToday ? null : 0,
        qualityEnd: isToday ? null : qualityEnd,
        qualityEndNote: isToday
          ? ""
          : lastDay
            ? `${bitter}. Масло слито (${disposedKg} кг), ванна промыта, завтра — свежее.`
            : dayInCycle === 0
              ? amber
              : weakTaste,
        carryoverKg,
        disposedKg: isToday ? 0 : disposedKg,
        controllerName: chef.name,
      };
      rows.push({
        documentId,
        employeeId: fryer.person.id,
        date: new Date(dateKey),
        data: json(data),
      });
    });
  }
  return rows;
}

function buildVentilationRows(
  documentId: string,
  rawConfig: unknown,
  windowKeys: string[],
  people: SeededPerson[],
  cleaner: SeededPerson,
): EntryRow[] {
  const config = normalizeCleaningVentilationConfig(
    rawConfig,
    people.map((p) => ({ id: p.id, name: p.name, role: p.role })),
  );
  const employeeId = config.mainResponsibleUserId || cleaner.id;
  const rows: EntryRow[] = [];
  for (const dateKey of windowKeys) {
    const data: CleaningVentilationChecklistEntryData = { procedures: {}, responsibleUserId: employeeId };
    for (const procedure of config.procedures) {
      if (!procedure.enabled) continue;
      data.procedures[procedure.id] = [...procedure.times];
    }
    rows.push({ documentId, employeeId, date: new Date(dateKey), data: json(data) });
  }
  return rows;
}

function buildUvRows(
  documentId: string,
  rawConfig: unknown,
  windowKeys: string[],
  responsible: SeededPerson,
): EntryRow[] {
  const config = normalizeUvRuntimeDocumentConfig(rawConfig);
  return windowKeys.map((dateKey) => ({
    documentId,
    employeeId: responsible.id,
    date: new Date(dateKey),
    data: json(buildUvRuntimeAutoFillEntryData(config.spec)),
  }));
}

// ────────────────────────────────────────────────────────────────────
// Журналы, которые живут в config документа.
// ────────────────────────────────────────────────────────────────────

/** Уборка: план Т/Г по расписанию помещений на всё окно, подписи, один пропуск. */
async function buildCleaningConfig(
  organizationId: string,
  rawConfig: unknown,
  windowKeys: string[],
  todayKey: string,
  ago: (k: number) => string | undefined,
): Promise<unknown> {
  const dbRooms = await db.room.findMany({
    where: { building: { organizationId } },
    select: {
      id: true,
      kind: true,
      sortOrder: true,
      currentDays: true,
      generalDays: true,
      currentScheduleType: true,
      generalScheduleType: true,
      currentMonthDays: true,
      generalMonthDays: true,
    },
    orderBy: { sortOrder: "asc" },
  });
  let config = normalizeCleaningDocumentConfig(rawConfig);
  config = applyRoomScheduleToMatrix(config, windowKeys, "fill-empty", toRoomScheduleMap(dbRooms));
  config = fillPastDaysNotPerformed(config, windowKeys, { todayKey });

  // Один честный пропуск: склад не убрали — в сетке «/» вместо «Т».
  const skipped = dbRooms.find((room) => room.kind === "storage") ?? dbRooms[dbRooms.length - 1];
  const skippedKey = ago(3);
  if (skipped && skippedKey && config.matrix[skipped.id]?.[skippedKey]) {
    config = setCleaningMatrixValue({ config, rowId: skipped.id, dateKey: skippedKey, value: "/" });
  }

  const cleaningCode = config.cleaningResponsibles[0]?.code;
  const controlCode = config.controlResponsibles[0]?.code;
  for (const dateKey of windowKeys) {
    if (cleaningCode) {
      config = setCleaningMatrixValue({
        config,
        rowId: CLEANING_SIGNATURE_ROW_ID,
        dateKey,
        value: markAutoSignature(cleaningCode),
      });
    }
    if (controlCode) {
      config = setCleaningMatrixValue({
        config,
        rowId: CONTROL_SIGNATURE_ROW_ID,
        dateKey,
        value: markAutoSignature(controlCode),
      });
    }
  }
  return config;
}

/** Интенсивное охлаждение: по блюду-два в рабочий день, одна партия в брак. */
function buildIntensiveCoolingConfig(
  rawConfig: unknown,
  windowKeys: string[],
  people: SeededPerson[],
  chef: SeededPerson,
  dishes: string[],
  ago: (k: number) => string | undefined,
): unknown {
  const config = normalizeIntensiveCoolingConfig(
    rawConfig,
    people.map((p) => ({ id: p.id, name: p.name, role: p.role })),
  );
  const badKey = ago(2);
  const rows = windowKeys.flatMap((dateKey, dayIndex) => {
    const perDay = dayIndex % 2 === 0 ? 2 : 1;
    return Array.from({ length: perDay }, (_, slot) => {
      const dish = dishes[(dayIndex * 2 + slot) % dishes.length];
      const isBad = dateKey === badKey && slot === 0;
      return createIntensiveCoolingRow({
        productionDate: dateKey,
        productionHour: slot === 0 ? "11" : "15",
        productionMinute: slot === 0 ? "30" : "10",
        dishName: dish,
        startTemperature: slot === 0 ? "78" : "82",
        endTemperature: isBad ? "12" : "4",
        correctiveAction: isBad
          ? "Охлаждение шло дольше 4 часов — партия утилизирована, шокфризер проверен мастером, датчик заменён."
          : "",
        comment: isBad ? "Компрессор шокфризера включился с задержкой" : "",
        responsibleTitle: chef.name,
        responsibleUserId: chef.id,
      });
    });
  });
  return { ...config, rows, dishSuggestions: Array.from(new Set([...dishes, ...config.dishSuggestions])) };
}

/**
 * Санитарный день: план на год (последняя суббота месяца), выполнено —
 * за прошедшие месяцы. Уборки — отдельными датами (2026-09-22), строки
 * plan/fact пересчитывает нормализатор.
 */
function buildSanitationConfig(
  rawConfig: unknown,
  today: Date,
  roomNames: string[],
  manager: SeededPerson,
  cleaner: SeededPerson,
): unknown {
  const config = normalizeSanitationDayConfig(rawConfig);
  const year = today.getUTCFullYear();
  const currentMonth = today.getUTCMonth();
  const rows = roomNames.map((name) => {
    const row = createEmptySanitationRow(name);
    const cleanings = SANITATION_MONTHS.map((_month, index) => {
      const date = `${year}-${String(index + 1).padStart(2, "0")}-${String(
        lastWeekdayOfMonth(year, index, 6),
      ).padStart(2, "0")}`;
      const done = index < currentMonth;
      return {
        id: `p:${date}`,
        planned: date,
        done: done ? date : null,
        ...(done ? { doneBy: cleaner.id, doneSource: "manual" as const } : {}),
      };
    });
    // Строки plan/fact не передаём: их пересчитает нормализатор из уборок.
    return { id: row.id, roomName: row.roomName, cleanings };
  });
  return normalizeSanitationDayConfig({
    ...config,
    year,
    approveRole: manager.position,
    approveEmployeeId: manager.id,
    approveEmployee: manager.name,
    responsibleRole: cleaner.position,
    responsibleEmployeeId: cleaner.id,
    responsibleEmployee: cleaner.name,
    rows,
  });
}

/** День месяца последнего вхождения дня недели (JS: 0=Вс … 6=Сб). */
function lastWeekdayOfMonth(year: number, month: number, jsWeekday: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const shift = (last.getUTCDay() - jsWeekday + 7) % 7;
  return last.getUTCDate() - shift;
}

/** Дезсредства: приход в начале окна, расход за окно с остатком. */
function buildDisinfectantConfig(
  rawConfig: unknown,
  windowKeys: string[],
  responsible: SeededPerson,
): unknown {
  const config = normalizeDisinfectantConfig(rawConfig);
  const role = responsible.position;
  const first = windowKeys[0];
  const last = windowKeys[windowKeys.length - 1];
  const receipts = [
    { name: "Ника-2", quantity: 5, unit: "l" as const, expiry: 2 },
    { name: "Абактерил-хлор", quantity: 3, unit: "kg" as const, expiry: 3 },
  ].map((item) => ({
    ...createEmptyReceipt(role, responsible.name, responsible.id),
    date: first,
    disinfectantName: item.name,
    quantity: item.quantity,
    unit: item.unit,
    expiryDate: `${Number(first.slice(0, 4)) + item.expiry}${first.slice(4)}`,
  }));
  const consumptions = [
    { name: "Ника-2", received: 5, consumed: 1.5, unit: "l" as const },
    { name: "Абактерил-хлор", received: 3, consumed: 0.6, unit: "kg" as const },
  ].map((item) => ({
    ...createEmptyConsumption(role, responsible.name, responsible.id),
    periodFrom: first,
    periodTo: last,
    disinfectantName: item.name,
    totalReceived: item.received,
    totalReceivedUnit: item.unit,
    totalConsumed: item.consumed,
    totalConsumedUnit: item.unit,
    remainder: Math.round((item.received - item.consumed) * 10) / 10,
    remainderUnit: item.unit,
  }));
  return {
    ...config,
    responsibleRole: role,
    responsibleEmployeeId: responsible.id,
    responsibleEmployee: responsible.name,
    receipts,
    consumptions,
  };
}

// ────────────────────────────────────────────────────────────────────
// Жизненный цикл демо для аккаунта.
// ────────────────────────────────────────────────────────────────────

/**
 * Демо для аккаунта владельца. Одно на аккаунт: живое — возвращаем как
 * есть; протухшее (cron ещё не дошёл) — удаляем и создаём заново.
 */
export async function createDemoOrganization(input: {
  accountId: string;
  ownerUserId: string;
  sphere: string;
}): Promise<{ organizationId: string; created: boolean; seed: SeedDemoResult | null }> {
  const now = new Date();
  const existing = await db.organization.findFirst({
    where: { accountId: input.accountId, isDemo: true },
    select: { id: true, demoExpiresAt: true },
  });
  if (existing) {
    if (!existing.demoExpiresAt || existing.demoExpiresAt > now) {
      return { organizationId: existing.id, created: false, seed: null };
    }
    await deleteDemoOrganization(existing.id);
  }

  const { organizationId } = await createOrganization({
    name: demoOrgName(input.sphere),
    sphere: input.sphere,
    accountId: input.accountId,
    ownerUserId: input.ownerUserId,
  });

  const preset = getOnboardingPreset(sphereToPreset(input.sphere));
  await db.organization.update({
    where: { id: organizationId },
    data: {
      isDemo: true,
      demoExpiresAt: demoExpiresAtFrom(now),
      // Ежедневные журналы продолжают заводиться cron'ом, как у ROOT-демо.
      autoJournalCodes: computeAutoJournalCodes(preset) as never,
      // createOrganization включает только «обязательные по закону» для
      // сферы; демо должно показать весь набор пресета, иначе половина
      // заполненных журналов спрятана за «выключено».
      disabledJournalCodes: computeDisabledJournalCodes(preset) as never,
    },
  });

  const seed = await seedDemoOrganizationData({
    organizationId,
    sphere: input.sphere,
    createdById: input.ownerUserId,
  });

  return { organizationId, created: true, seed };
}

export type DeleteDemoResult = { staff: number; documents: number; entries: number };

/** Счётчики для тоста «Удалено: …» — без удаления. */
export async function countDemoOrganization(organizationId: string): Promise<DeleteDemoResult> {
  const [staff, documents, entries] = await Promise.all([
    db.user.count({ where: { organizationId } }),
    db.journalDocument.count({ where: { organizationId } }),
    db.journalDocumentEntry.count({ where: { document: { organizationId } } }),
  ]);
  return { staff, documents, entries };
}

/**
 * Удаляет демо целиком. Все org-скоупные таблицы каскадятся с
 * Organization; TF-интеграции у демо не бывает, поэтому обход задач в
 * TasksFlow (как у ROOT-удаления) не нужен.
 */
export async function deleteDemoOrganization(organizationId: string): Promise<DeleteDemoResult> {
  const counts = await countDemoOrganization(organizationId);
  // `isDemo: true` в where — страховка от удаления боевой организации
  // по подставленному id: Prisma бросит P2025, а не снесёт данные.
  await db.organization.delete({ where: { id: organizationId, isDemo: true } });
  return counts;
}
