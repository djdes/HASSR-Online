import {
  BLANK_DOWNLOAD_AUDIT_ACTION,
  type BlankTarget,
} from "@/lib/blank-download";
import {
  blankExtrasEquipmentRows,
  countBlankExtras,
  normalizeBlankExtras,
  type BlankExtras,
  type BlankExtrasCounts,
  type BlankExtrasPerson,
} from "@/lib/blank-download-extras";
import { blankQrUrl } from "@/lib/blank-qr-token";
import { db } from "@/lib/db";
import { applyOrganizationPlace, resolveOrganizationPlaceForRequest } from "@/lib/organization-place.server";
import { journalShortQrUrl } from "@/lib/journal-pdf-qr-link";
import { createStaffMember } from "@/lib/staff-create";

/**
 * «Дополнительно» из окна скачивания — серверная часть (спека
 * blank-download-extras-2026-11).
 *
 * Хранение без новых таблиц: очищенные данные лежат в `details.extras`
 * записи AuditLog `blank.download` платформы (её `entityId` — id согласия).
 * Подписанная ссылка на файл несёт этот id (`k`), роут файла достаёт данные
 * и печатает их в бланке.
 */

const PLATFORM_ORG_ID = process.env.PLATFORM_ORG_ID || "platform";

/** Доп. данные скачивания по id согласия. Нет записи или битые данные — `null`. */
export async function loadBlankDownloadExtras(
  consentId: string | null | undefined,
  code: string | null,
): Promise<BlankExtras | null> {
  if (!consentId) return null;
  const row = await db.auditLog.findFirst({
    where: {
      organizationId: PLATFORM_ORG_ID,
      action: BLANK_DOWNLOAD_AUDIT_ACTION,
      entity: "LegalConsent",
      entityId: consentId,
    },
    select: { details: true },
  });
  const details = row?.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  return normalizeBlankExtras((details as Record<string, unknown>).extras, code);
}

/**
 * QR в скачанном файле. Кабинет создан быстрой регистрацией этого же
 * скачивания — QR журнала кабинета (`/qj/…`: сотрудник выбирает себя и
 * пишет запись по PIN). Иначе — `/qb/<токен>`: регистрация или вход с
 * подставленной почтой.
 */
export function blankFileQrUrl(params: {
  origin: string;
  target: BlankTarget;
  email: string | null;
  organizationId?: string | null;
}): string {
  if (params.organizationId && params.target.kind === "code") {
    return journalShortQrUrl(params.origin, params.organizationId, params.target.code);
  }
  return blankQrUrl(params.origin, { target: params.target, email: params.email }).url;
}

export type BlankAccountExtrasResult = BlankExtrasCounts & { failed: number };

const DEFAULT_STAFF_POSITION = "Сотрудник";
const DEFAULT_RESPONSIBLE_POSITION = "Ответственный";
const DEFAULT_AREA_NAME = "Основной цех";

async function ensurePosition(organizationId: string, categoryKey: "staff" | "management", rawName: string | undefined) {
  const name = (rawName ?? "").trim() || (categoryKey === "management" ? DEFAULT_RESPONSIBLE_POSITION : DEFAULT_STAFF_POSITION);
  const existing = await db.jobPosition.findUnique({
    where: { organizationId_categoryKey_name: { organizationId, categoryKey, name } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const last = await db.jobPosition.findFirst({
    where: { organizationId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const created = await db.jobPosition.create({
    data: { organizationId, categoryKey, name, sortOrder: (last?.sortOrder ?? 0) + 1 },
    select: { id: true },
  });
  return created.id;
}

/**
 * Быстрая регистрация из окна скачивания: введённое в «Дополнительно» — в
 * новый кабинет. Сотрудники и ответственный — в «Сотрудники» (без входа,
 * как заведённые руководителем), помещения — цеха, оборудование — в первый
 * цех (или «Основной цех»). Часовой пояс браузера — в организацию.
 *
 * Каждая запись — отдельно и с перехватом: сбой одной строки не роняет ни
 * остальные, ни скачивание.
 */
export async function applyBlankExtrasToAccount(params: {
  organizationId: string;
  code: string | null;
  extras: BlankExtras | null | undefined;
  timeZone?: string | null;
  /** IP и заголовки клиента — город и страна организации по IP. */
  ip?: string | null;
  headers?: Headers | null;
}): Promise<BlankAccountExtrasResult> {
  const { organizationId, code, extras } = params;
  const result: BlankAccountExtrasResult = { ...countBlankExtras(null), failed: 0 };

  // Пояс браузера, город и страна по IP — в организацию: время журналов
  // нового кабинета сразу местное (спека tg-client-location-2026-11).
  const place = await resolveOrganizationPlaceForRequest(
    { browserTimeZone: params.timeZone },
    { ip: params.ip, headers: params.headers },
  ).catch(() => null);
  await applyOrganizationPlace(organizationId, place);
  if (!extras) return result;

  const addPerson = async (person: BlankExtrasPerson, category: "staff" | "management") => {
    try {
      const jobPositionId = await ensurePosition(organizationId, category, person.position);
      const created = await createStaffMember(organizationId, { jobPositionId, fullName: person.name });
      if (!created.ok) throw new Error(created.error);
      return true;
    } catch (error) {
      console.error("[blank-extras] staff create failed", error);
      result.failed += 1;
      return false;
    }
  };

  if (extras.responsible && (await addPerson(extras.responsible, "management"))) result.responsible += 1;
  for (const person of extras.employees ?? []) {
    // Ответственного из списка сотрудников второй раз не заводим.
    if (extras.responsible && person.name === extras.responsible.name) continue;
    if (await addPerson(person, "staff")) result.employees += 1;
  }

  for (const name of extras.rooms ?? []) {
    try {
      const existing = await db.area.findFirst({ where: { organizationId, name }, select: { id: true } });
      if (!existing) await db.area.create({ data: { organizationId, name } });
      result.rooms += 1;
    } catch (error) {
      console.error("[blank-extras] area create failed", error);
      result.failed += 1;
    }
  }

  const equipment = blankExtrasEquipmentRows(extras, code);
  if (equipment.length) {
    try {
      const area =
        (await db.area.findFirst({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true } })) ??
        (await db.area.create({ data: { organizationId, name: DEFAULT_AREA_NAME }, select: { id: true } }));
      for (const item of equipment) {
        try {
          await db.equipment.create({
            data: { areaId: area.id, name: item.name, type: item.type, tempMin: item.tempMin, tempMax: item.tempMax },
          });
          result.equipment += 1;
        } catch (error) {
          console.error("[blank-extras] equipment create failed", error);
          result.failed += 1;
        }
      }
    } catch (error) {
      console.error("[blank-extras] equipment area failed", error);
      result.failed += equipment.length;
    }
  }

  result.total = result.responsible + result.employees + result.equipment + result.rooms;
  return result;
}
