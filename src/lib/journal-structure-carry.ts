import { CLIMATE_DOCUMENT_TEMPLATE_CODE } from "@/lib/climate-document";
import { COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE } from "@/lib/cold-equipment-document";
import { DOCUMENT_COPY_SUPPORTED_CODES, copyDocumentStructure } from "@/lib/journal-document-copy";
import { UV_LAMP_RUNTIME_TEMPLATE_CODE } from "@/lib/uv-lamp-runtime-document";

/**
 * «Новый период — по образцу прошлого» (чистая функция, без БД).
 *
 * Документ нового периода рождается сам — ночным кроном или первым
 * QR-сканом после смены периода. Раньше он собирался «с нуля» из
 * справочника: холодильники теряли режим замеров («2 раза в день»),
 * склады — свои сроки контроля, УФ-лампа — паспорт и номер. Человек у
 * наклейки видел не тот бланк, что вчера.
 *
 * Переносим только СТРУКТУРУ и только белый список журналов:
 *   • холодильники — состав (без удалённых из «Оборудования») и выходные;
 *   • климат — помещения (без удалённых), сроки контроля и выходные;
 *   • УФ-лампа — конфиг целиком (связь с удалённой лампой снимается);
 *   • журналы с «Сделать копию» — `copyDocumentStructure` (факт обнулён).
 * Журналы, у которых строки конфига — это ФАКТ (бракераж, аварии,
 * претензии…), не переносятся никогда: скопировать их — значит задвоить
 * записи прошлого периода.
 *
 * `null` — переносить нечего: документ соберётся как раньше, из
 * справочника и дефолтов журнала.
 */

export type StructureCarryNeeds = { equipment: boolean; rooms: boolean };

export type StructureCarryOptions = {
  /** Живое оборудование организации (для холодильников и УФ-ламп). */
  liveEquipmentIds?: ReadonlySet<string>;
  /** Живые помещения справочника (для климата). */
  liveRoomIds?: ReadonlySet<string>;
  /** Начало нового периода, `YYYY-MM-DD` (год и дата в шапке). */
  periodFrom: string;
  /** Название нового документа — если журнал дублирует его в конфиге. */
  documentTitle?: string;
};

/** Какие id справочника нужны переносу; `null` — журнал не переносится. */
export function structureCarryNeeds(templateCode: string): StructureCarryNeeds | null {
  if (templateCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE || templateCode === UV_LAMP_RUNTIME_TEMPLATE_CODE) {
    return { equipment: true, rooms: false };
  }
  if (templateCode === CLIMATE_DOCUMENT_TEMPLATE_CODE) return { equipment: false, rooms: true };
  if (DOCUMENT_COPY_SUPPORTED_CODES.has(templateCode)) return { equipment: false, rooms: false };
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item): item is Record<string, unknown> => item !== null) : [];
}

function linkedId(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Строка без связи со справочником — ручная, её не трогаем; со связью — только живая. */
function isAlive(id: string | null, live: ReadonlySet<string> | undefined): boolean {
  return id === null || !live || live.has(id);
}

export function carryStructureFromPrevious(
  templateCode: string,
  previousConfig: unknown,
  options: StructureCarryOptions
): Record<string, unknown> | null {
  const previous = asRecord(previousConfig);
  if (!previous) return null;

  if (templateCode === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE) {
    const equipment = records(previous.equipment)
      .filter((item) => isAlive(linkedId(item.sourceEquipmentId), options.liveEquipmentIds))
      .map((item) => ({ ...item }));
    if (equipment.length === 0) return null;
    return { equipment, skipWeekends: previous.skipWeekends === true };
  }

  if (templateCode === CLIMATE_DOCUMENT_TEMPLATE_CODE) {
    const rooms = records(previous.rooms)
      .filter((room) => isAlive(linkedId(room.roomId), options.liveRoomIds))
      .map((room) => ({ ...room }));
    if (rooms.length === 0) return null;
    const controlTimes = Array.isArray(previous.controlTimes)
      ? previous.controlTimes.filter((time): time is string => typeof time === "string" && time.trim() !== "")
      : [];
    return {
      rooms,
      ...(controlTimes.length > 0 ? { controlTimes } : {}),
      skipWeekends: previous.skipWeekends === true,
    };
  }

  if (templateCode === UV_LAMP_RUNTIME_TEMPLATE_CODE) {
    if (Object.keys(previous).length === 0) return null;
    const config = { ...previous };
    const equipmentId = linkedId(config.equipmentId);
    if (equipmentId && !isAlive(equipmentId, options.liveEquipmentIds)) delete config.equipmentId;
    return config;
  }

  if (DOCUMENT_COPY_SUPPORTED_CODES.has(templateCode)) {
    const config = copyDocumentStructure(templateCode, previous, options.periodFrom);
    if (Object.keys(config).length === 0) return null;
    if ("documentName" in config && options.documentTitle) config.documentName = options.documentTitle;
    return config;
  }

  return null;
}
