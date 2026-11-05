import { db } from "@/lib/db";
import {
  ADDED_AUTOMATION_FEATURES,
  automationDisabledError,
  automationOn,
  parseJournalControls,
  readStoredAutomation,
  resolveAddedFeature,
  resolveLegacyAutomation,
  type AddedAutomationFeature,
  type AutomationFeature,
  type JournalAutomationControls,
  type JournalControls,
} from "@/lib/journal-controls";
import { parseJournalAutomationJson } from "@/lib/journal-automation";
import { NextResponse } from "next/server";

type Client = Pick<typeof db, "organization" | "building" | "journalDocument" | "auditLog">;

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
    : NextResponse.json({ error: automationDisabledError(features[0]) }, { status: 403 });
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
  const automation = resolveLegacyAutomation({ legacySpecialMode, createdAt: org.createdAt, usesAutomation });
  return withAddedFeatures(client, organizationId, automation, ADDED_AUTOMATION_FEATURES);
}

/** Пользовалась ли организация этой (позже добавленной) функцией. */
async function usedAddedFeature(client: Client, organizationId: string, feature: AddedAutomationFeature): Promise<boolean> {
  switch (feature) {
    case "catchUp":
      // «Догнать пропуски» пишет в аудит `journal_entry.copy` с этим `via`.
      return Boolean(await client.auditLog.findFirst({
        where: { organizationId, action: "journal_entry.copy", details: { path: ["via"], equals: "dashboard.catch_up" } },
        select: { id: true },
      }));
  }
}

/** Дополняет выбор галочками, которых в нём ещё не было, — по `resolveAddedFeature`. */
async function withAddedFeatures(
  client: Client,
  organizationId: string,
  automation: JournalAutomationControls,
  missing: readonly AddedAutomationFeature[],
): Promise<JournalAutomationControls> {
  const next = { ...automation };
  for (const feature of missing) {
    next[feature] = automation.enabled
      ? resolveAddedFeature({ specialModeOn: true, used: await usedAddedFeature(client, organizationId, feature) })
      : false;
  }
  return next;
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
  const stored = readStoredAutomation(row?.value);
  if (stored.automation && stored.missing.length === 0) return parseJournalControls(row?.value);
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
    if (stored.automation && stored.missing.length === 0 && Object.keys(patch).length === 0) return current;
    const automation = patch.automation ??
      (stored.automation ? await withAddedFeatures(tx, organizationId, stored.automation, stored.missing) : null) ??
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
