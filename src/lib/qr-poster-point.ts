import { isOfficeBuilding } from "@/lib/building-scope";
import { posterPointLine, type PosterPointLine } from "@/lib/ppk/poster-point";

/**
 * Торговая точка на QR-кодах: плакатах A4 и A5, наклейках и табличках
 * (2026-10-28, вслед за памятками по скану 97: «на всех страницах
 * наименование торговой точки, для которой они печатаются» — то же нашли
 * на наклейках складов и оборудования). Чистые функции, без БД.
 *
 * Чья точка печатается:
 *   • у объекта — своя: помещение — его здание, оборудование — точка цеха;
 *   • у цеха без точки и у плакатов журналов — точка, для которой печатают
 *     (точка из шапки кабинета);
 *   • иначе — единственная торговая точка организации;
 *   • иначе строки нет: точек несколько, а выбрана «Вся организация».
 * Текст плаката — как на памятках (`posterPointLine`): наименование для
 * журналов или название и адрес. На наклейке и табличке строка одна и узкая:
 * длинное юридическое наименование обрезалось бы на общем начале («МАУ «КП
 * «Дружба», пищебл…») у всех точек сразу, поэтому там — короткое название.
 */

export type QrPointBuilding = {
  id: string;
  name: string;
  address: string | null;
  journalName?: string | null;
  kind?: string;
};

/** Точка, для которой печатают: выбранная в шапке, иначе единственная торговая точка. */
export function qrPrintPoint(
  buildings: readonly QrPointBuilding[],
  printPointId: string | null | undefined,
): QrPointBuilding | null {
  const chosen = printPointId ? buildings.find((building) => building.id === printPointId) : undefined;
  if (chosen) return chosen;
  const stores = buildings.filter((building) => !isOfficeBuilding(building));
  return stores.length === 1 ? stores[0] : null;
}

/** Строка точки на QR: плакату — `title` и `detail`, наклейке и табличке — `short`. */
export type QrPosterPointLine = PosterPointLine & { short: string };

/** Строка точки на QR: своя точка объекта или документа, иначе точка печати. */
export function qrPosterPoint(
  buildings: readonly QrPointBuilding[],
  ownBuildingId: string | null | undefined,
  printPointId: string | null | undefined,
): QrPosterPointLine | null {
  const own = ownBuildingId ? buildings.find((building) => building.id === ownBuildingId) : undefined;
  const building = own ?? qrPrintPoint(buildings, printPointId);
  const line = posterPointLine(building);
  if (!building || !line) return null;
  return { ...line, short: building.name.replace(/\s+/g, " ").trim() || line.title };
}
