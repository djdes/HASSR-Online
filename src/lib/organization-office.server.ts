import { OFFICE_BUILDING_KIND } from "@/lib/building-scope";
import { db } from "@/lib/db";
import {
  DIRECTORY_ORGANIZATION_KIND,
  planOfficeOpening,
  type OfficeOpening,
  type OfficeOpeningTotals,
} from "@/lib/organization-office";
import { closePointManagerSessions } from "@/lib/point-scope.server";

/**
 * Открыть офис организации (владелец, 2026-11-24: офис у всех по умолчанию,
 * кнопки «Выделить офис» больше нет). Правила — `organization-office.ts`.
 * Зовут: каждое создание объекта (страница «Объекты», шаблон онбординга,
 * анкета регистрации, демо, обмен справочниками), страница «Офис» и разовый
 * шаг выкладки `prisma/seed-open-office-2026-11.ts`.
 */

const platformOrganizationId = () => (process.env.PLATFORM_ORG_ID ?? "").trim() || "platform";

export type OfficeOpened = {
  opened: boolean;
  officeId: string | null;
  created: boolean;
  splitEnabled: boolean;
  sessionsClosed: number;
};

const NOTHING: OfficeOpened = { opened: false, officeId: null, created: false, splitEnabled: false, sessionsClosed: 0 };

/** Что нужно организации, чтобы офис был открыт (только чтение); null — ничего. */
export async function planOrganizationOffice(organizationId: string): Promise<OfficeOpening | null> {
  const [organization, buildings] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { kind: true, perLocationJournals: true } }),
    db.building.findMany({ where: { organizationId }, select: { id: true, kind: true, name: true, sortOrder: true } }),
  ]);
  if (!organization) return null;
  return planOfficeOpening({
    organizationId,
    kind: organization.kind,
    perLocationJournals: organization.perLocationJournals,
    buildings,
    platformOrganizationId: platformOrganizationId(),
  });
}

/**
 * Открывает офис, если он ещё не открыт: здание офиса (название, адрес и
 * телефон компании, первым в списке) и журналы по объектам — как кнопка
 * «Выделить офис». Запись в журнале действий `building.office_opened`.
 * Руководители, закреплённые за объектами, становятся руководителями
 * объектов: их сессии перевыпускаются (кроме `actor`). Идемпотентно; два
 * объекта, созданных одновременно, не заводят два офиса (блокировка на
 * организацию в транзакции).
 */
export async function openOrganizationOffice(
  organizationId: string,
  options: { source: string; actor?: { id: string; name?: string | null } | null },
): Promise<OfficeOpened> {
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`office:${organizationId}`}))`;
    const [organization, buildings] = await Promise.all([
      tx.organization.findUnique({
        where: { id: organizationId },
        select: { kind: true, perLocationJournals: true, address: true, phone: true },
      }),
      tx.building.findMany({ where: { organizationId }, select: { id: true, kind: true, name: true, sortOrder: true } }),
    ]);
    if (!organization) return NOTHING;
    const plan = planOfficeOpening({
      organizationId,
      kind: organization.kind,
      perLocationJournals: organization.perLocationJournals,
      buildings,
      platformOrganizationId: platformOrganizationId(),
    });
    if (!plan) return NOTHING;
    let officeId = plan.officeId;
    if (plan.createOffice) {
      const office = await tx.building.create({
        data: {
          organizationId,
          kind: OFFICE_BUILDING_KIND,
          name: plan.officeName ?? "Офис",
          address: organization.address,
          phone: organization.phone,
          sortOrder: plan.sortOrder ?? -1,
        },
        select: { id: true },
      });
      officeId = office.id;
    }
    if (plan.enableSplit) {
      await tx.organization.update({ where: { id: organizationId }, data: { perLocationJournals: true } });
    }
    await tx.auditLog.create({
      data: {
        organizationId,
        userId: options.actor?.id ?? null,
        userName: options.actor?.name ?? "WeSetup",
        action: "building.office_opened",
        entity: "building",
        entityId: officeId,
        // Для возврата: создан ли офис и какими были журналы до открытия.
        details: {
          source: options.source,
          created: plan.createOffice,
          perLocationJournalsBefore: organization.perLocationJournals,
        },
      },
    });
    return { opened: true, officeId, created: plan.createOffice, splitEnabled: plan.enableSplit, sessionsClosed: 0 };
  });
  if (!result.opened) return result;
  const sessionsClosed = await closePointManagerSessions(organizationId, options.actor?.id).catch((error) => {
    console.error("[organization-office] closePointManagerSessions failed", error);
    return 0;
  });
  return { ...result, sessionsClosed };
}

/**
 * Разовый шаг выкладки (владелец: «организации у которых не выделено
 * открой»): открыть офис каждой обычной организации с объектами. Платформа,
 * мастер-кабинеты справочников и организации без объектов не трогаются.
 * `dryRun` — только посчитать.
 */
export async function openOfficesForAllOrganizations(options: { dryRun: boolean }): Promise<OfficeOpeningTotals> {
  const candidates = await db.organization.findMany({
    where: {
      id: { not: platformOrganizationId() },
      kind: { not: DIRECTORY_ORGANIZATION_KIND },
      buildings: { some: { kind: { not: OFFICE_BUILDING_KIND } } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const totals: OfficeOpeningTotals = { organizations: 0, officesCreated: 0, splitEnabled: 0, sessionsClosed: 0 };
  for (const { id } of candidates) {
    if (options.dryRun) {
      const plan = await planOrganizationOffice(id);
      if (!plan) continue;
      totals.organizations += 1;
      if (plan.createOffice) totals.officesCreated += 1;
      if (plan.enableSplit) totals.splitEnabled += 1;
      continue;
    }
    const opened = await openOrganizationOffice(id, { source: "deploy-2026-11-24" });
    if (!opened.opened) continue;
    totals.organizations += 1;
    if (opened.created) totals.officesCreated += 1;
    if (opened.splitEnabled) totals.splitEnabled += 1;
    totals.sessionsClosed += opened.sessionsClosed;
  }
  return totals;
}
