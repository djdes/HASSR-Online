import ru from "@/i18n/messages/ru.json";
import { db } from "@/lib/db";
import { loadDocumentOrgBlock } from "@/lib/document-org-block.server";
import { effectiveObjectCategory } from "@/lib/object-categories";
import { loadEnabledJournals } from "./journals.server";
import { parsePpkRecords, type PpkTextBlock } from "./records";
import { ppkWhere, type PpkScope } from "./scope";
import { loadPpkStaff } from "./staff.server";
import type { DraftBlock, DraftContext } from "./text-drafts";

const HAZARD_TYPE_RU = { bio: "биологический", chem: "химический", phys: "физический", allergen: "аллерген" } as const;
const CONTROL_KIND_RU = { ccp: "ККТ", oprp: "ПОПМ (операционная)", prp: "ПОПМ", none: "не требуется" } as const;
const ROLE_ORDER = { leader: 0, deputy: 1, member: 2, secretary: 3 } as const;

/**
 * Данные кабинета для черновика пункта (2026-11-25): только область ППК
 * (точка или организация) — состав группы ХАССП, продукция, опасные факторы,
 * контрольные точки, журналы, помещения и текущий текст пункта.
 */
export async function loadDraftContext(scope: PpkScope, block: DraftBlock): Promise<DraftContext> {
  const where = ppkWhere(scope);
  const [orgBlock, org, building, staff, records, current, journals, rooms] = await Promise.all([
    loadDocumentOrgBlock(scope.organizationId, { buildingId: scope.buildingId }),
    db.organization.findUnique({ where: { id: scope.organizationId }, select: { type: true } }),
    scope.buildingId
      ? db.building.findFirst({
          where: { id: scope.buildingId, organizationId: scope.organizationId },
          select: { name: true, journalName: true, address: true, sphere: true },
        })
      : Promise.resolve(null),
    loadPpkStaff(scope),
    db.ppkRecord.findMany({
      where: { ...where, block: { in: ["team", "products", "hazards", "control-points"] } },
      select: { id: true, block: true, data: true, sortOrder: true, updatedAt: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      take: 400,
    }),
    db.ppkRecord.findFirst({
      where: { ...where, block },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
    }),
    loadEnabledJournals(scope.organizationId, scope.buildingId),
    scope.buildingId
      ? db.room.findMany({ where: { buildingId: scope.buildingId }, select: { name: true }, orderBy: { sortOrder: "asc" }, take: 60 })
      : Promise.resolve([]),
  ]);

  const of = <B extends "team" | "products" | "hazards" | "control-points">(name: B) =>
    parsePpkRecords(name, records.filter((row) => row.block === name)).map((row) => row.data);
  const people = new Map(staff.map((person) => [person.id, person]));
  const team = of("team")
    .filter((member) => people.has(member.userId))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
    .map((member) => ({ name: people.get(member.userId)!.name, title: people.get(member.userId)!.title, role: member.role }));
  const hazardRows = parsePpkRecords("hazards", records.filter((row) => row.block === "hazards"));
  const hazardById = new Map(hazardRows.map((row) => [row.id, row.data]));
  const category = effectiveObjectCategory(building?.sphere, org?.type);
  const currentText = current ? (parsePpkRecords(block as PpkTextBlock, [current])[0]?.data.text ?? "") : "";

  return {
    organization: orgBlock?.org.shortName || orgBlock?.org.fullName || "",
    object: building ? building.journalName || building.name : null,
    address: building?.address || null,
    sphere: category ? ru.common.objectCategories[category] : "не указана",
    food: category === null || category === "food",
    staffCount: staff.length,
    team,
    products: of("products").map((product) => product.name),
    hazards: hazardRows.map((row) => `${row.data.step} — ${row.data.hazard} (${HAZARD_TYPE_RU[row.data.type]})`),
    controlPoints: of("control-points")
      .filter((point) => point.kind !== "none")
      .map((point) => {
        const hazard = point.hazardId ? hazardById.get(point.hazardId) : undefined;
        return `${CONTROL_KIND_RU[point.kind]}${point.number ? ` ${point.number}` : ""}${hazard ? ` — ${hazard.step}: ${hazard.hazard}` : ""}`;
      }),
    journals: journals.map((journal) => journal.name),
    rooms: rooms.map((room) => room.name),
    currentText,
  };
}
