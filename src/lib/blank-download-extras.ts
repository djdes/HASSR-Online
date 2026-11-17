/**
 * «Дополнительно» в окне скачивания шаблона журнала (спека
 * `.agent/tasks/blank-download-extras-2026-11/spec.md`).
 *
 * Под полем «Название компании» человек может раскрыть несколько полей под
 * конкретный журнал: сотрудников (гигиенический, журнал здоровья…),
 * оборудование (холодильники, фритюрницы…), помещения (уборка, климат…) и
 * ответственного. Всё необязательное: введённое печатается в скачанном
 * файле, а при быстрой регистрации — заводится в кабинет.
 *
 * Чистый модуль без БД и node:crypto — его берут и окно в браузере, и
 * сервер.
 */

export type BlankExtrasPerson = { name: string; position?: string };
export type BlankEquipmentKind = "fridge" | "freezer";
export type BlankExtrasEquipment = { name: string; kind?: BlankEquipmentKind };

import { normalizeBlankLayout, type BlankLayout } from "@/lib/blank-layout";

export type BlankExtras = {
  /** Свой бланк из конструктора: название, колонки, строки (только PDF). */
  layout?: BlankLayout;
  /** Ответственный за ведение журнала (ФИО и должность). */
  responsible?: BlankExtrasPerson;
  employees?: BlankExtrasPerson[];
  equipment?: BlankExtrasEquipment[];
  rooms?: string[];
};

/** Какие разделы «Дополнительно» есть у журнала. Ответственный — у всех. */
export type BlankExtrasSections = {
  employees: boolean;
  /** `cold` — холодильное оборудование с выбором «холодильник / морозильник». */
  equipment: "cold" | "generic" | null;
  rooms: boolean;
};

export const BLANK_EXTRAS_MAX_ROWS = 10;
export const BLANK_EXTRAS_FIELD_MAX = 80;

const EMPLOYEE_JOURNALS = new Set(["hygiene", "health_check", "med_books", "staff_training", "ppe_issuance"]);
const COLD_EQUIPMENT_JOURNALS = new Set(["cold_equipment_control"]);
const EQUIPMENT_JOURNALS = new Set([
  "fryer_oil",
  "equipment_maintenance",
  "equipment_calibration",
  "equipment_cleaning",
  "uv_lamp_runtime",
  "breakdown_history",
]);
const ROOM_JOURNALS = new Set([
  "cleaning",
  "general_cleaning",
  "climate_control",
  "cleaning_ventilation_checklist",
  "sanitary_day_control",
  "disinfectant_usage",
  "pest_control",
]);

/** Нормы холодильного оборудования, которые ставим в кабинете и в бланке. */
export const BLANK_EQUIPMENT_TEMPS: Record<BlankEquipmentKind, { tempMin: number; tempMax: number }> = {
  fridge: { tempMin: 2, tempMax: 6 },
  freezer: { tempMin: -24, tempMax: -18 },
};

/** Разделы для журнала каталога; у бумажных бланков — только ответственный. */
export function blankExtrasSections(code: string | null | undefined): BlankExtrasSections {
  const key = code ?? "";
  return {
    employees: EMPLOYEE_JOURNALS.has(key),
    equipment: COLD_EQUIPMENT_JOURNALS.has(key) ? "cold" : EQUIPMENT_JOURNALS.has(key) ? "generic" : null,
    rooms: ROOM_JOURNALS.has(key),
  };
}

function cleanText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, BLANK_EXTRAS_FIELD_MAX);
}

function cleanPerson(raw: unknown): BlankExtrasPerson | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const name = cleanText(value.name);
  if (!name) return null;
  const position = cleanText(value.position);
  return position ? { name, position } : { name };
}

function rows<T>(raw: unknown, clean: (item: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw.slice(0, BLANK_EXTRAS_MAX_ROWS * 3)) {
    const value = clean(item);
    if (value) out.push(value);
    if (out.length >= BLANK_EXTRAS_MAX_ROWS) break;
  }
  return out;
}

/**
 * Ввод из окна → чистые данные. Пустые строки и разделы, которых у этого
 * журнала нет, отбрасываются; ничего не осталось — `null`.
 */
export function normalizeBlankExtras(raw: unknown, code: string | null | undefined): BlankExtras | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const sections = blankExtrasSections(code);
  const out: BlankExtras = {};

  const responsible = cleanPerson(value.responsible);
  if (responsible) out.responsible = responsible;

  const layout = normalizeBlankLayout(value.layout);
  if (layout) out.layout = layout;

  if (sections.employees) {
    const employees = rows(value.employees, cleanPerson);
    if (employees.length) out.employees = employees;
  }
  if (sections.equipment) {
    const cold = sections.equipment === "cold";
    const equipment = rows(value.equipment, (item): BlankExtrasEquipment | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name = cleanText(record.name);
      if (!name) return null;
      if (!cold) return { name };
      return { name, kind: record.kind === "freezer" ? "freezer" : "fridge" };
    });
    if (equipment.length) out.equipment = equipment;
  }
  if (sections.rooms) {
    const rooms = rows(value.rooms, (item) => cleanText(item) || null);
    const unique = [...new Set(rooms)];
    if (unique.length) out.rooms = unique;
  }
  return Object.keys(out).length ? out : null;
}

export type BlankExtrasCounts = {
  total: number;
  responsible: number;
  employees: number;
  equipment: number;
  rooms: number;
};

/** Сколько всего человек ввёл: ответственный, каждый сотрудник, единица оборудования, помещение. */
export function countBlankExtras(extras: BlankExtras | null | undefined): BlankExtrasCounts {
  const responsible = extras?.responsible ? 1 : 0;
  const employees = extras?.employees?.length ?? 0;
  const equipment = extras?.equipment?.length ?? 0;
  const rooms = extras?.rooms?.length ?? 0;
  return { total: responsible + employees + equipment + rooms, responsible, employees, equipment, rooms };
}

/**
 * Строка для уведомления продажам: «Доп. данные: 5 (ответственный,
 * сотрудники — 3, оборудование — 1)». Ничего не вводили — `null`.
 */
export function blankExtrasAdminLine(extras: BlankExtras | null | undefined): string | null {
  const counts = countBlankExtras(extras);
  if (counts.total === 0) return null;
  const parts = [
    counts.responsible ? "ответственный" : null,
    counts.employees ? `сотрудники — ${counts.employees}` : null,
    counts.equipment ? `оборудование — ${counts.equipment}` : null,
    counts.rooms ? `помещения — ${counts.rooms}` : null,
  ].filter(Boolean);
  return `➕ Доп. данные: ${counts.total} (${parts.join(", ")})`;
}

/** Код типа оборудования в кабинете (`Equipment.type`) для журнала и выбора в окне. */
export function blankEquipmentType(code: string | null | undefined, kind?: BlankEquipmentKind): string {
  if (kind === "freezer") return "freezer";
  if (kind === "fridge") return "refrigerator";
  if (code === "fryer_oil") return "fryer";
  if (code === "uv_lamp_runtime") return "uv_lamp";
  return "other";
}

/** Оборудование из окна в виде справочника (для бланка и кабинета). */
export function blankExtrasEquipmentRows(
  extras: BlankExtras | null | undefined,
  code: string | null | undefined,
): Array<{ name: string; type: string; tempMin: number | null; tempMax: number | null }> {
  return (extras?.equipment ?? []).map((item) => ({
    name: item.name,
    type: blankEquipmentType(code, item.kind),
    tempMin: item.kind ? BLANK_EQUIPMENT_TEMPS[item.kind].tempMin : null,
    tempMax: item.kind ? BLANK_EQUIPMENT_TEMPS[item.kind].tempMax : null,
  }));
}
