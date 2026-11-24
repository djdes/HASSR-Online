import { isOfficeBuilding } from "@/lib/building-scope";

/**
 * Офис у всех по умолчанию (владелец, 2026-11-24: «"Выделить офис" убери и
 * сделай по умолчанию всем с офисом, организации у которых не выделено
 * открой»). «Открыть офис» — то, что делала кнопка «Выделить офис»: здание
 * офиса (`kind = "office"`) и журналы по объектам (`perLocationJournals`).
 *
 * Офис открывается вместе с первым объектом: без объектов офис был бы
 * единственным зданием, и всё «по умолчанию в первое здание» (помещения,
 * цеха, оборудование) уходило бы в офис. Чистые правила без Prisma — их
 * читают открытие офиса (`organization-office.server.ts`), разовый шаг
 * выкладки и тесты.
 */

/** Названия офиса по порядку: первое свободное в организации. */
export const OFFICE_NAMES = ["Офис", "Офис компании", "Офис организации"] as const;

/**
 * Вид организации «мастер-кабинет справочников» — служебная, без мест
 * (`MASTER_ORG_KIND` в `master-directory.ts`; здесь — копия, чтобы правила
 * не тянули базу; тест сверяет их).
 */
export const DIRECTORY_ORGANIZATION_KIND = "directory";

export type OfficeOpeningInput = {
  organizationId: string;
  /** `Organization.kind`: "regular" или служебный "directory". */
  kind: string | null | undefined;
  perLocationJournals: boolean;
  buildings: ReadonlyArray<{ id: string; kind?: string | null; name: string; sortOrder: number }>;
  /** `PLATFORM_ORG_ID` — служебная организация платформы. */
  platformOrganizationId: string;
};

export type OfficeOpening = {
  /** Создать здание офиса. */
  createOffice: boolean;
  /** Включить журналы по объектам. */
  enableSplit: boolean;
  /** Офис, который уже есть (null — будет создан). */
  officeId: string | null;
  /** Название и место в списке нового офиса (первым, как раньше у кнопки). */
  officeName: string | null;
  sortOrder: number | null;
};

/** Что сделать, чтобы офис организации был открыт; null — уже открыт или открывать нечему. */
export function planOfficeOpening(input: OfficeOpeningInput): OfficeOpening | null {
  if (input.organizationId === input.platformOrganizationId) return null;
  if (input.kind === DIRECTORY_ORGANIZATION_KIND) return null;
  if (!input.buildings.some((building) => !isOfficeBuilding(building))) return null;
  const office = input.buildings.find(isOfficeBuilding) ?? null;
  const createOffice = office === null;
  const enableSplit = !input.perLocationJournals;
  if (!createOffice && !enableSplit) return null;
  const taken = new Set(input.buildings.map((building) => building.name.trim()));
  let officeName: string | null = null;
  if (createOffice) {
    officeName = OFFICE_NAMES.find((name) => !taken.has(name)) ?? null;
    for (let number = 2; officeName === null; number += 1) {
      if (!taken.has(`Офис ${number}`)) officeName = `Офис ${number}`;
    }
  }
  const firstSortOrder = Math.min(...input.buildings.map((building) => building.sortOrder));
  return {
    createOffice,
    enableSplit,
    officeId: office?.id ?? null,
    officeName,
    sortOrder: createOffice ? firstSortOrder - 1 : null,
  };
}

/**
 * Кто из руководства сохраняет права на всю компанию, когда открывается офис
 * (проверка 2026-11-24). Без офиса закреплённый за всеми объектами работает
 * на всю компанию (`pointScopeForUser`), а при офисе он стал бы руководителем
 * объектов и потерял «Мою компанию» — как владелец, закреплённый за своим
 * единственным объектом. Такие становятся «без места»: вся компания и работа
 * на всех объектах, как было. Закреплённые за частью объектов — руководители
 * своих объектов (так делала и кнопка «Выделить офис»); того, кто открыл офис,
 * кнопка переводила в офис — так и остаётся.
 */
export function managersKeepingCompanyAccess(input: {
  buildings: ReadonlyArray<{ id: string; kind?: string | null }>;
  managers: ReadonlyArray<{ id: string; buildingIds: readonly string[] }>;
  actorId?: string | null;
}): { free: string[]; toOffice: string[] } {
  const known = new Set(input.buildings.map((building) => building.id));
  const office = input.buildings.find(isOfficeBuilding) ?? null;
  const objects = input.buildings.filter((building) => !isOfficeBuilding(building)).map((building) => building.id);
  const free: string[] = [];
  const toOffice: string[] = [];
  for (const manager of input.managers) {
    const places = manager.buildingIds.filter((id) => known.has(id));
    // Без места или только удалённые места — и так вся компания; в офисе — тоже.
    if (places.length === 0 || (office !== null && places.includes(office.id))) continue;
    if (objects.length > 0 && objects.every((id) => places.includes(id))) free.push(manager.id);
    else if (input.actorId && manager.id === input.actorId) toOffice.push(manager.id);
  }
  return { free, toOffice };
}

/** Итоги открытия офисов (разовый шаг выкладки): в лог — только числа. */
export type OfficeOpeningTotals = {
  organizations: number;
  officesCreated: number;
  splitEnabled: number;
  sessionsClosed: number;
  /** Руководство, оставшееся на всю компанию («без места» или в офисе). */
  managersKeptCompanyWide: number;
  /** Компании, где открыть офис не удалось: повтор — на следующей выкладке. */
  failed: number;
};
