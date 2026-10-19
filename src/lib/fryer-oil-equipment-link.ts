/**
 * Журнал фритюра ↔ справочник «Оборудование» (2026-10-17, план 4.3).
 *
 * Как у холодильников (`sourceEquipmentId`): фритюрница, заведённая в
 * «Оборудовании», сама появляется в списке фритюрниц документа, а
 * переименование в справочнике доходит до списка. Здесь только чистые
 * функции — их берут серверная синхронизация
 * (`fryer-oil-equipment-sync.ts`), API журнала и QR-наклейка.
 */
import {
  DEFAULT_EQUIPMENT_TYPES,
  fryerOilDayKey,
  fryerOilQualityPhrase,
  isFryerOilEntryDataEmpty,
  type FryerOilDocumentConfig,
  type FryerOilEntryData,
  type FryerOilEquipmentLink,
} from "@/lib/fryer-oil-document";
import { normalizePlaceName } from "@/lib/orphan-areas";

/** Тип оборудования «Фритюрница» в справочнике. */
export const FRYER_EQUIPMENT_TYPE = "fryer";

export function isFryerEquipmentType(type: string | null | undefined): boolean {
  const value = (type ?? "").trim().toLowerCase();
  return value === FRYER_EQUIPMENT_TYPE || value === "фритюрница";
}

export type FryerDirectoryItem = { id: string; name: string };

const same = (a: string, b: string) => normalizePlaceName(a) === normalizePlaceName(b);

/**
 * Фритюрницы, которые видит документ точки `documentBuildingId`: документ
 * без точки (общий) — все; документ точки — свои и без точки.
 */
export function fryersForDocument<T extends { buildingId: string | null }>(
  fryers: ReadonlyArray<T>,
  documentBuildingId: string | null,
): T[] {
  if (!documentBuildingId) return [...fryers];
  return fryers.filter((fryer) => !fryer.buildingId || fryer.buildingId === documentBuildingId);
}

/**
 * Список фритюрниц документа по справочнику.
 *
 *  • связанная фритюрница переименована — новое имя встаёт на место старого;
 *  • фритюрницы нет в справочнике (удалили, перенесли в другую точку) —
 *    связь снимается, имя в списке остаётся: им подписаны прошлые строки;
 *  • новая фритюрница справочника — связывается с одноимённой позицией
 *    списка или добавляется в конец;
 *  • образцы «Фритюрница №1–3» убираются, когда есть настоящие фритюрницы
 *    и образцом не подписана ни одна строка (`usedNames`).
 */
export function syncFryerOilEquipment(
  config: FryerOilDocumentConfig,
  directory: ReadonlyArray<FryerDirectoryItem>,
  usedNames: Iterable<string> = [],
): { config: FryerOilDocumentConfig; changed: boolean } {
  let names = config.lists.equipmentTypes.map((name) => name.trim()).filter(Boolean);
  const byId = new Map(directory.map((item) => [item.id, item.name.trim()]));
  const links: FryerOilEquipmentLink[] = [];

  for (const link of config.equipmentLinks) {
    const current = byId.get(link.sourceEquipmentId);
    if (current === undefined || !current) continue;
    if (!same(current, link.name)) {
      const hasNew = names.some((name) => same(name, current));
      names = hasNew
        ? names.filter((name) => !same(name, link.name))
        : names.map((name) => (same(name, link.name) ? current : name));
    }
    if (!names.some((name) => same(name, current))) names.push(current);
    links.push({ sourceEquipmentId: link.sourceEquipmentId, name: current });
  }

  for (const item of directory) {
    const name = item.name.trim();
    if (!name || links.some((link) => link.sourceEquipmentId === item.id)) continue;
    // Одно имя — одна фритюрница: вторую с тем же названием в списке не различить.
    if (links.some((link) => same(link.name, name))) continue;
    const existing = names.find((value) => same(value, name));
    if (!existing) names.push(name);
    links.push({ sourceEquipmentId: item.id, name: existing ?? name });
  }

  if (links.length > 0) {
    const used = new Set([...usedNames].map(normalizePlaceName));
    names = names.filter(
      (name) =>
        !DEFAULT_EQUIPMENT_TYPES.includes(name) ||
        links.some((link) => same(link.name, name)) ||
        used.has(normalizePlaceName(name)),
    );
  }

  const next: FryerOilDocumentConfig = {
    ...config,
    lists: { ...config.lists, equipmentTypes: names },
    equipmentLinks: links,
  };
  const changed =
    JSON.stringify(next.lists.equipmentTypes) !== JSON.stringify(config.lists.equipmentTypes) ||
    JSON.stringify(next.equipmentLinks) !== JSON.stringify(config.equipmentLinks);
  return { config: changed ? next : config, changed };
}

/** Фритюрница строки по имени из списка документа (форма журнала шлёт только имя). */
export function fryerSourceIdForName(
  links: ReadonlyArray<FryerOilEquipmentLink>,
  equipmentType: string,
): string | null {
  if (!equipmentType.trim()) return null;
  return links.find((link) => same(link.name, equipmentType))?.sourceEquipmentId ?? null;
}

/** Строка журнала со ссылкой на фритюрницу, если имя связано со справочником. */
export function withFryerSource(
  data: FryerOilEntryData,
  links: ReadonlyArray<FryerOilEquipmentLink>,
): FryerOilEntryData {
  const sourceEquipmentId = fryerSourceIdForName(links, data.equipmentType);
  if (sourceEquipmentId) return { ...data, sourceEquipmentId };
  if (!data.sourceEquipmentId) return data;
  // Имя сменили на несвязанное — старая ссылка больше не про эту строку.
  const rest = { ...data };
  delete rest.sourceEquipmentId;
  return rest;
}

// ---------- QR-наклейка фритюрницы

export type FryerQrEntry = { id: string; date: string; data: FryerOilEntryData };

export type FryerQrRow =
  | { kind: "existing"; entry: FryerQrEntry }
  | { kind: "seeded"; entry: FryerQrEntry }
  | { kind: "new" };

/**
 * Строка этой фритюрницы за сегодня: со ссылкой на неё, иначе с её именем
 * (строки, внесённые на сайте до связи), иначе пустая заготовка дня, иначе
 * новая строка.
 */
export function pickFryerQrRow(
  entries: ReadonlyArray<FryerQrEntry>,
  target: { equipmentId: string; equipmentName: string; dayKey: string },
): FryerQrRow {
  const day = entries.filter((entry) => fryerOilDayKey(entry) === target.dayKey);
  const linked = day.find((entry) => entry.data.sourceEquipmentId === target.equipmentId);
  if (linked) return { kind: "existing", entry: linked };
  const byName = day.find(
    (entry) => !entry.data.sourceEquipmentId && entry.data.equipmentType && same(entry.data.equipmentType, target.equipmentName),
  );
  if (byName) return { kind: "existing", entry: byName };
  const seeded = day.find((entry) => isFryerOilEntryDataEmpty(entry.data));
  if (seeded) return { kind: "seeded", entry: seeded };
  return { kind: "new" };
}

/** Что спрашивает наклейка: начало жарки или её окончание. */
export function fryerQrPhase(row: FryerQrRow): "start" | "end" {
  return row.kind === "existing" && row.entry.data.qualityStart !== null ? "end" : "start";
}

/**
 * Жир и продукция последней жарки этой фритюрницы — форма наклейки
 * подставляет их, повар меняет, только если сегодня иначе.
 */
export function lastFryerValues(
  entries: ReadonlyArray<FryerQrEntry>,
  target: { equipmentId: string; equipmentName: string },
): { fatType: string; productType: string } | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const data = entries[index].data;
    const mine =
      data.sourceEquipmentId === target.equipmentId ||
      (!data.sourceEquipmentId && Boolean(data.equipmentType) && same(data.equipmentType, target.equipmentName));
    if (mine && data.fatType) return { fatType: data.fatType, productType: data.productType };
  }
  return null;
}

// ---------- запись с наклейки

export type FryerQrInput =
  | { phase: "start"; fatType: string; productType: string; quality: number }
  | { phase: "end"; quality: number; carryoverKg: number; disposedKg: number };

/** Часы и минуты «сейчас» в зоне организации. */
export function nowInZone(timezone: string, at: Date = new Date()): { hour: number; minute: number; label: string } {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour12: false, hour: "2-digit", minute: "2-digit" })
        .formatToParts(at)
        .map((part) => [part.type, part.value]),
    );
    const hour = Number(parts.hour === "24" ? "0" : parts.hour);
    const minute = Number(parts.minute);
    return { hour, minute, label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
  } catch {
    return { hour: at.getUTCHours(), minute: at.getUTCMinutes(), label: at.toISOString().slice(11, 16) };
  }
}

/** Данные строки после скана — чистая функция (тесты). */
export function buildFryerQrEntryData(params: {
  base: FryerOilEntryData;
  input: FryerQrInput;
  equipment: { id: string; name: string };
  employeeName: string;
  dayKey: string;
  time: { hour: number; minute: number };
}): FryerOilEntryData {
  const { base, input, equipment, employeeName, dayKey, time } = params;
  if (input.phase === "end") {
    return {
      ...base,
      endHour: time.hour,
      endMinute: time.minute,
      qualityEnd: input.quality,
      qualityEndNote: fryerOilQualityPhrase(input.quality),
      carryoverKg: input.carryoverKg,
      disposedKg: input.disposedKg,
      controllerName: base.controllerName || employeeName,
    };
  }
  return {
    ...base,
    startDate: dayKey,
    startHour: time.hour,
    startMinute: time.minute,
    fatType: input.fatType,
    productType: input.productType,
    qualityStart: input.quality,
    qualityStartNote: fryerOilQualityPhrase(input.quality),
    equipmentType: equipment.name,
    sourceEquipmentId: equipment.id,
    controllerName: base.controllerName || employeeName,
  };
}

