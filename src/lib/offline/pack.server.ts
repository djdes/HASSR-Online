import type { Session } from "next-auth";

import { getActiveBuildingId } from "@/lib/active-building";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { buildingTargets } from "@/lib/building-targets";
import { DEFAULT_CLIMATE_HUMIDITY, DEFAULT_CLIMATE_TEMPERATURE, normalizeClimateRoomNorms } from "@/lib/climate-document";
import { parseCustomNames } from "@/lib/custom-names";
import { db } from "@/lib/db";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { resolveEquipmentFillTargets, resolveFryerFillTarget } from "@/lib/equipment-fill-targets";
import { isFryerEquipmentType } from "@/lib/fryer-oil-equipment-link";
import { decryptSecret, isIntegrationCryptoConfigured } from "@/lib/integration-crypto";
import { isCommissionJournalCode } from "@/lib/brakerage-commission";
import {
  journalFillSubject,
  listFillEmployees,
  listHubJournals,
  listJournalFillDocuments,
  loadJournalFillForm,
  loadOrganizationForFill,
  normalizeQrFillMode,
  scopeDocumentsToBuilding,
  todayKeyFor,
} from "@/lib/journal-fill";
import { journalFillHints } from "@/lib/journal-fill-hints";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { canFillObject } from "@/lib/object-fillers";
import { mintQrFillToken } from "@/lib/qr-fill-token";
import { qrPinFingerprint } from "@/lib/qr-pin-pass";
import { loadQrPointScope, worksAtQrPoint, type QrPointScope } from "@/lib/qr-point-roster";
import { loadObjectJournalStatus } from "@/lib/qr-object-journal-status";
import type { ReadingPhotoSettings } from "@/lib/reading-photo-fixation";
import { getReadingPhotoSettings } from "@/lib/reading-photo-fixation.server";
import { getAdapter } from "@/lib/tasksflow-adapters";
import { rowKeyForEmployee } from "@/lib/tasksflow-adapters/row-key";
import type { TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";
import { isManagementRole, getUserDisplayTitle } from "@/lib/user-roles";
import { isUvLampEquipment } from "@/lib/uv-lamp";

import { historyToPlain } from "./history";
import { loadFillHistory } from "./history.server";
import type { OfflineValues } from "./merge";
import { loadStoredHistory } from "./stored-values.server";
import { makeOfflinePinVerifier, type OfflinePinVerifier } from "./pin-verifier";
import {
  OFFLINE_PACK_VERSION,
  type OfflinePack,
  type OfflinePackDocument,
  type OfflinePackEmployee,
  type OfflinePackJournal,
  type OfflinePackObject,
  type OfflinePhotoMode,
} from "./types";

/**
 * Offline pack: everything the device needs to keep filling journals with
 * no network — who works here, which journals and objects exist, their
 * forms and the last month of row values. Built for the organization of
 * the signed-in session and the same journals the "all journals" QR hub
 * shows; nothing of other organizations ever gets in.
 */

/** PBKDF2 is deliberately slow; a verifier stays valid while the PIN does, so it is derived once per PIN. */
const verifierCache = new Map<string, OfflinePinVerifier>();
const VERIFIER_CACHE_LIMIT = 5000;

async function pinVerifierFor(userId: string, qrPinHash: string, qrPinEncrypted: string | null): Promise<OfflinePinVerifier | null> {
  if (!qrPinEncrypted || !isIntegrationCryptoConfigured()) return null;
  const cacheKey = `${userId}:${qrPinFingerprint(qrPinHash)}`;
  const cached = verifierCache.get(cacheKey);
  if (cached) return cached;
  let pin: string;
  try {
    pin = decryptSecret(qrPinEncrypted);
  } catch {
    return null;
  }
  const verifier = await makeOfflinePinVerifier(pin);
  if (verifierCache.size >= VERIFIER_CACHE_LIMIT) verifierCache.clear();
  verifierCache.set(cacheKey, verifier);
  return verifier;
}

async function inBatches<T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(...(await Promise.all(items.slice(index, index + size).map(run))));
  }
  return out;
}

const photoMode = (settings: ReadingPhotoSettings | null): OfflinePhotoMode => (!settings?.enabled ? "off" : settings.required ? "required" : "optional");

/** Fat and product lists with the last used value first, as the online sticker page offers them. */
function withLast(list: readonly string[], last: string | null | undefined): string[] {
  const value = last?.trim();
  return value && !list.includes(value) ? [value, ...list] : [...list];
}

type RosterUser = {
  id: string;
  name: string;
  role: string;
  canManageSettings: boolean;
  buildingIds: string[];
};

export async function buildOfflinePack(session: Session): Promise<OfflinePack | null> {
  const organizationId = getActiveOrgId(session);
  const org = await loadOrganizationForFill(organizationId);
  if (!org) return null;
  const timeZone = org.timezone || "Europe/Moscow";
  const todayKey = todayKeyFor(timeZone);
  const now = new Date();
  const [activeBuildingId, orgTargets] = await Promise.all([getActiveBuildingId(session).catch(() => null), buildingTargets(organizationId)]);
  const disabledCodes = [...parseDisabledCodes(org.disabledJournalCodes)];

  // --- people -------------------------------------------------------------
  const roster = await db.user.findMany({
    where: { organizationId, ...ORG_ROSTER_WHERE },
    select: {
      id: true,
      name: true,
      role: true,
      positionTitle: true,
      jobPosition: { select: { name: true } },
      canManageSettings: true,
      buildingIds: true,
      qrPinHash: true,
      qrPinEncrypted: true,
    },
    orderBy: { name: "asc" },
  });
  const employees: OfflinePackEmployee[] = await inBatches(roster, 4, async (user) => ({
    id: user.id,
    name: user.name,
    positionTitle: getUserDisplayTitle(user) || null,
    hasPin: Boolean(user.qrPinHash),
    pin: user.qrPinHash ? await pinVerifierFor(user.id, user.qrPinHash, user.qrPinEncrypted) : null,
    pinFp: user.qrPinHash ? qrPinFingerprint(user.qrPinHash) : null,
    isManagement: isManagementRole(user.role) || user.canManageSettings === true,
  }));
  const rosterUsers: RosterUser[] = roster;

  const scopeCache = new Map<string, Promise<QrPointScope>>();
  const pointScope = (buildingId: string | null) => {
    const key = buildingId ?? "";
    if (!scopeCache.has(key)) scopeCache.set(key, loadQrPointScope(organizationId, buildingId));
    return scopeCache.get(key)!;
  };

  // --- journals -----------------------------------------------------------
  const hub = await listHubJournals(organizationId, disabledCodes, todayKey, { names: parseCustomNames(org.customNamesJson) });
  const templates = await db.journalTemplate.findMany({ where: { code: { in: hub.map((item) => item.code) } }, select: { code: true, taskScope: true } });
  const scopeByCode = new Map(templates.map((template) => [template.code, template.taskScope]));

  const journals: OfflinePackJournal[] = [];
  for (const item of hub) {
    const adapter = getAdapter(item.code);
    if (!adapter?.getTaskForm) continue;
    const docs = scopeDocumentsToBuilding(await listJournalFillDocuments(organizationId, item.code, todayKey), activeBuildingId, orgTargets);
    if (docs.length === 0) continue;
    const adapterDocs = await adapter.listDocumentsForOrg(organizationId).catch(() => []);
    const append = scopeByCode.get(item.code) === "shared" || journalFillHints(item.code).append === true;
    const history = append ? new Map() : await loadFillHistory(organizationId, docs.map((doc) => doc.id), now);
    // Сколько записей сделано сегодня через формы — для отметки «заполнено сегодня» на главном экране.
    const todayRows = await db.auditLog.groupBy({
      by: ["entityId"],
      where: {
        organizationId,
        action: "journal.qr_fill",
        entity: "JournalDocument",
        entityId: { in: docs.map((doc) => doc.id) },
        details: { path: ["dateKey"], equals: todayKey },
      },
      _count: { _all: true },
    });
    const todayCountByDoc = new Map(todayRows.map((row) => [row.entityId, row._count._all]));
    const includeCommission = isCommissionJournalCode(item.code);

    const documents: OfflinePackDocument[] = [];
    for (const doc of docs) {
      const scope = await pointScope(doc.buildingId);
      const allowed = (await listFillEmployees(organizationId, { pointScope: scope, includeCommission })).map((employee) => employee.id);
      const rows = adapterDocs.find((candidate) => candidate.documentId === doc.id)?.rows ?? [];
      const perEmployee = rows.length === 0 || rows.every((row) => row.rowKey.startsWith("employee-"));
      const rowKeys = perEmployee ? allowed.map((id) => rowKeyForEmployee(id)) : rows.map((row) => row.rowKey);
      const forms: Record<string, TaskFormSchema> = {};
      await inBatches(rowKeys, 6, async (rowKey) => {
        const form = await loadJournalFillForm(item.code, doc.id, rowKey).catch(() => null);
        if (form) forms[rowKey] = form;
      });
      if (Object.keys(forms).length === 0) continue;
      // История строк: записи форм (аудит), а поверх — то, что реально лежит в журнале
      // (гигиена, здоровье, чек-лист уборки): так видны и правки из таблицы кабинета.
      const docHistory: Map<string, Map<string, OfflineValues>> = new Map(history.get(doc.id) ?? []);
      if (!append) {
        const stored = await loadStoredHistory({
          code: item.code,
          documentId: doc.id,
          fieldKeysByRow: new Map(Object.entries(forms).map(([rowKey, form]) => [rowKey, form.fields.map((field) => field.key)])),
          todayKey,
        });
        for (const [rowKey, days] of stored) docHistory.set(rowKey, new Map([...(docHistory.get(rowKey) ?? []), ...days]));
      }
      documents.push({
        id: doc.id,
        title: doc.title,
        building: doc.building,
        buildingId: doc.buildingId,
        dateFrom: doc.dateFrom,
        dateTo: doc.dateTo,
        perEmployee,
        rows: perEmployee
          ? []
          : rows
              .filter((row) => forms[row.rowKey])
              .map((row) => ({ rowKey: row.rowKey, label: row.label, ...(row.sublabel ? { sublabel: row.sublabel } : {}), responsibleUserId: row.responsibleUserId })),
        forms,
        employeeIds: allowed,
        history: historyToPlain(docHistory),
        todayCount: append
          ? (todayCountByDoc.get(doc.id) ?? 0)
          : Array.from(docHistory.values()).filter((days) => days.has(todayKey)).length,
      });
    }
    if (documents.length === 0) continue;
    journals.push({
      code: item.code,
      name: item.name,
      append,
      token: mintQrFillToken("journal", journalFillSubject(organizationId, item.code)),
      documents,
    });
  }

  // --- objects with their own stickers --------------------------------------
  const objects: OfflinePackObject[] = [];
  const fillersFor = async (buildingId: string | null, fillerUserIds: readonly string[]) => {
    const scope = await pointScope(buildingId);
    return rosterUsers.filter((user) => worksAtQrPoint(scope, user.buildingIds) && canFillObject(fillerUserIds, user)).map((user) => user.id);
  };
  const inPoint = (buildingId: string | null) => !activeBuildingId || !orgTargets.includes(activeBuildingId) || buildingId === null || buildingId === activeBuildingId;
  const day = new Date(`${todayKey}T00:00:00.000Z`);

  const coldEnabled = !disabledCodes.includes("cold_equipment_control");
  const uvEnabled = !disabledCodes.includes("uv_lamp_runtime");
  const climateEnabled = !disabledCodes.includes("climate_control");
  const [coldPhoto, climatePhoto] = await Promise.all([
    getReadingPhotoSettings(organizationId, "cold_equipment_control").catch(() => null),
    getReadingPhotoSettings(organizationId, "climate_control").catch(() => null),
  ]);

  // Что уже заполнено сегодня по объектам — те же данные, что показывает QR журнала с интернетом.
  const todayByObject = new Map<string, { done: boolean; summary: string }>();
  for (const code of ["cold_equipment_control", "climate_control", "uv_lamp_runtime"]) {
    if (disabledCodes.includes(code)) continue;
    const groups = await loadObjectJournalStatus({ organizationId, code, todayKey, timezone: timeZone }).catch(() => []);
    for (const group of groups) for (const item of group.items) todayByObject.set(item.id, { done: item.state === "done", summary: item.summary });
  }

  const equipment = await db.equipment.findMany({
    where: { area: { organizationId } },
    orderBy: [{ area: { name: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, type: true, tempMin: true, tempMax: true, fillerUserIds: true, area: { select: { id: true, name: true, buildingId: true } } },
  });
  for (const item of equipment) {
    if (!inPoint(item.area.buildingId)) continue;
    const base = {
      kind: "equipment" as const,
      id: item.id,
      name: item.name,
      place: item.area.name || null,
      buildingId: item.area.buildingId,
      token: mintQrFillToken("equipment", item.id),
      humidity: null,
      employeeIds: await fillersFor(item.area.buildingId, item.fillerUserIds),
      today: todayByObject.get(item.id) ?? null,
    };
    if (isUvLampEquipment(item)) {
      if (uvEnabled) objects.push({ ...base, fill: "uv", temperature: null, photo: "off" });
      continue;
    }
    if (isFryerEquipmentType(item.type)) {
      if (disabledCodes.includes("fryer_oil")) continue;
      const target = await resolveFryerFillTarget({ equipment: { id: item.id, name: item.name, buildingId: item.area.buildingId }, organizationId, day }).catch(() => null);
      if (!target) {
        objects.push({ ...base, fill: "unsupported", unsupportedReason: "Фритюрница сегодня не входит ни в один журнал учёта фритюрных жиров", temperature: null, photo: "off" });
        continue;
      }
      const fatTypes = withLast(target.config.lists.fatTypes, target.last?.fatType);
      const productTypes = withLast(target.config.lists.productTypes, target.last?.productType);
      objects.push({
        ...base,
        fill: "fryer",
        temperature: null,
        photo: "off",
        fryer: {
          fatTypes,
          productTypes,
          fatType: target.last?.fatType || fatTypes[0] || "",
          productType: target.last?.productType || productTypes[0] || "",
          phase: target.phase,
        },
        today: { done: target.phase === "end", summary: target.phase === "end" ? "жарка начата" : "" },
      });
      continue;
    }
    if (!coldEnabled) continue;
    const targets = await resolveEquipmentFillTargets({ equipment: { id: item.id, areaId: item.area.id, areaName: item.area.name }, organizationId, day }).catch(() => null);
    if (!targets?.hasActiveDocument) continue;
    const humidity = targets.climate?.row.humidity.enabled ? { min: targets.climate.row.humidity.min, max: targets.climate.row.humidity.max } : null;
    objects.push({
      ...base,
      fill: "temperature",
      temperature: { min: item.tempMin, max: item.tempMax },
      humidity,
      photo: photoMode(coldPhoto),
    });
  }

  if (climateEnabled) {
    const rooms = await db.room.findMany({
      where: { building: { organizationId } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, climateNorms: true, buildingId: true, fillerUserIds: true, building: { select: { name: true } } },
    });
    for (const room of rooms) {
      if (!inPoint(room.buildingId)) continue;
      const norms = normalizeClimateRoomNorms(room.climateNorms);
      const temperature = norms?.temperature ?? DEFAULT_CLIMATE_TEMPERATURE;
      const humidity = norms?.humidity ?? DEFAULT_CLIMATE_HUMIDITY;
      objects.push({
        kind: "room",
        id: room.id,
        name: room.name,
        place: room.building?.name ?? null,
        buildingId: room.buildingId,
        token: mintQrFillToken("room", room.id),
        fill: "climate",
        temperature: temperature.enabled ? { min: temperature.min, max: temperature.max } : null,
        humidity: humidity.enabled ? { min: humidity.min, max: humidity.max } : null,
        photo: photoMode(climatePhoto),
        today: todayByObject.get(room.id) ?? null,
        employeeIds: await fillersFor(room.buildingId, room.fillerUserIds),
      });
    }
  }

  return {
    version: OFFLINE_PACK_VERSION,
    generatedAt: now.toISOString(),
    user: { id: session.user.id, name: session.user.name ?? "" },
    organization: { id: org.id, name: org.name, timeZone, qrFillMode: normalizeQrFillMode(org.qrFillMode) },
    todayKey,
    employees,
    journals,
    objects,
  };
}
