import { db } from "@/lib/db";
import {
  automationDisabledError,
  automationOn,
  parseJournalControls,
  readStoredAutomation,
  resolveLegacyAutomation,
  type AutomationFeature,
  type JournalAutomationControls,
  type JournalControls,
} from "@/lib/journal-controls";
import { parseJournalAutomationJson } from "@/lib/journal-automation";
import { NextResponse } from "next/server";

type Client = Pick<typeof db, "organization" | "building" | "journalDocument">;

/**
 * 403, если эта часть автоматики выключена в спецрежиме организации
 * (спецрежим выключен или галочка не стоит). Список — «хватит любой из».
 * Текст называет функцию и где её включить.
 */
export async function rejectJournalAutomation(organizationId: string, feature: AutomationFeature | readonly AutomationFeature[]) {
  const features: readonly AutomationFeature[] = typeof feature === "string" ? [feature] : feature;
  const controls = await getJournalControls(organizationId);
  return features.some((item) => automationOn(controls, item))
    ? null
    : NextResponse.json({ error: automationDisabledError(features[0]), code: "special_mode", feature: features[0] }, { status: 403 });
}

function hasCodes(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === "string" && item.length > 0);
}

function hasAutomation(row: { journalAutomationJson: unknown; autoJournalCodes: unknown } | null | undefined): boolean {
  if (!row) return false;
  return hasCodes(row.autoJournalCodes) ||
    Object.values(parseJournalAutomationJson(row.journalAutomationJson)).some((item) => item.autoCreate || item.autoFill);
}

/**
 * «Пользуется автоматикой»: автосоздание/автозаполнение в настройках
 * журналов организации или любой её точки, либо активный документ с
 * включённым автозаполнением. Организации нет — null.
 */
async function legacyAutomation(client: Client, organizationId: string, legacySpecialMode: boolean): Promise<JournalAutomationControls | null> {
  const org = await client.organization.findUnique({
    where: { id: organizationId },
    select: { createdAt: true, journalAutomationJson: true, autoJournalCodes: true },
  });
  if (!org) return null;
  let usesAutomation = hasAutomation(org);
  if (!usesAutomation && !legacySpecialMode) {
    const buildings = await client.building.findMany({
      where: { organizationId },
      select: { journalAutomationJson: true, autoJournalCodes: true },
    });
    usesAutomation = buildings.some(hasAutomation) ||
      Boolean(await client.journalDocument.findFirst({ where: { organizationId, status: "active", autoFill: true }, select: { id: true } }));
  }
  return resolveLegacyAutomation({ legacySpecialMode, createdAt: org.createdAt, usesAutomation });
}

function settingKey(organizationId: string) {
  return `org-journal-controls:${organizationId}`;
}

/**
 * Настройки журналов организации. Без сохранённого выбора спецрежима
 * решает правило `resolveLegacyAutomation`, и решение сразу записывается:
 * «пользовалась автоматикой» фиксируется при первом чтении после выкладки
 * и не переключается само, когда, например, закроется последний документ
 * с автозаполнением.
 */
export async function getJournalControls(organizationId: string): Promise<JournalControls> {
  const row = await db.platformSetting.findUnique({ where: { key: settingKey(organizationId) }, select: { value: true } });
  if (readStoredAutomation(row?.value).automation) return parseJournalControls(row?.value);
  return updateJournalControls(organizationId, {});
}

export async function updateJournalControls(organizationId: string, patch: Partial<JournalControls>): Promise<JournalControls> {
  return db.$transaction(async (tx) => {
    const key = settingKey(organizationId);
    // Serializes updates to different journal flags within the same organization.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key})::bigint)`;
    const row = await tx.platformSetting.findUnique({ where: { key }, select: { value: true } });
    const current = parseJournalControls(row?.value);
    const stored = readStoredAutomation(row?.value);
    if (stored.automation && Object.keys(patch).length === 0) return current;
    const automation = patch.automation ?? stored.automation ??
      (await legacyAutomation(tx, organizationId, stored.legacySpecialMode));
    // Организации нет — ничего не пишем, отвечаем «выключено».
    if (!automation) return current;
    // Прежний `specialMode` в запись не попадает: parseJournalControls его не знает.
    const next = parseJournalControls({
      ...current,
      ...patch,
      automation,
      sensorCamera: { ...current.sensorCamera, ...patch.sensorCamera },
      brakerageSetup: { ...current.brakerageSetup, ...patch.brakerageSetup },
    });
    await tx.platformSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
    return next;
  });
}
