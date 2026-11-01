/**
 * Smart CAPA auto-creation for repeated temperature violations.
 *
 * Rule: if the same equipment had at least one out-of-range reading on
 * each of the last 3 calendar days, open a CAPA ticket with a pre-filled
 * «Проверить оборудование» draft. Manager then refines rootCause /
 * correctiveAction / preventiveAction and closes it.
 *
 * Idempotency: we tag auto-created tickets with `sourceType =
 * "auto_temp_3days"` and `sourceEntryId = equipmentId`. Before creating
 * a new one we look for an existing OPEN ticket with the same markers —
 * if one is already active, we skip. Once the manager closes it and
 * temperatures keep deviating, a fresh ticket can be opened on the next
 * run.
 */
import { db } from "@/lib/db";
import { getDbRoleValuesWithLegacy, MANAGER_ROLES } from "@/lib/user-roles";
import { listOnDutyToday } from "@/lib/work-shifts";
import { staffAtBuildingWhere } from "@/lib/building-settings";

const SOURCE_TYPE = "auto_temp_3days";

function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

type CapaSummary = {
  created: number;
  skippedExisting: number;
  candidates: number;
  details: Array<{
    equipmentId: string;
    equipmentName: string;
    ticketId?: string;
    skipped?: "already-open" | "no-manager";
  }>;
};

export async function detectTemperatureCapas(args: {
  organizationId: string;
  now?: Date;
}): Promise<CapaSummary> {
  const now = args.now ?? new Date();
  const today = utcDayStart(now);
  const threeDaysAgo = new Date(today);
  threeDaysAgo.setUTCDate(threeDaysAgo.getUTCDate() - 2); // inclusive: d-2, d-1, d
  const windowEnd = new Date(today);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);

  const equipmentList = await db.equipment.findMany({
    where: {
      area: { organizationId: args.organizationId },
      // Only equipment with declared limits — without them «out-of-range»
      // has no meaning.
      OR: [{ tempMin: { not: null } }, { tempMax: { not: null } }],
    },
    select: { id: true, name: true, tempMin: true, tempMax: true, area: { select: { buildingId: true } } },
  });
  if (equipmentList.length === 0) {
    return { created: 0, skippedExisting: 0, candidates: 0, details: [] };
  }

  const equipmentIds = equipmentList.map((e) => e.id);

  // Pull every legacy JournalEntry for the last 3 days for these
  // fridges. Legacy table is where Tuya writes; manual cold-equipment
  // grid lives in JournalDocumentEntry and we inspect that separately.
  const legacyEntries = await db.journalEntry.findMany({
    where: {
      organizationId: args.organizationId,
      equipmentId: { in: equipmentIds },
      createdAt: { gte: threeDaysAgo, lt: windowEnd },
    },
    select: {
      equipmentId: true,
      createdAt: true,
      data: true,
    },
  });

  type Reading = { date: string; temperature: number };
  const readingsByEquipment = new Map<string, Reading[]>();
  for (const entry of legacyEntries) {
    if (!entry.equipmentId) continue;
    const temp = (entry.data as { temperature?: unknown } | null)?.temperature;
    if (typeof temp !== "number" || !Number.isFinite(temp)) continue;
    const dateKey = entry.createdAt.toISOString().slice(0, 10);
    const list = readingsByEquipment.get(entry.equipmentId) ?? [];
    list.push({ date: dateKey, temperature: temp });
    readingsByEquipment.set(entry.equipmentId, list);
  }

  // Also scan cold_equipment_control document entries — those carry a
  // map `temperatures[configItemId]`. We have to map configItemId back
  // to equipmentId via config.sourceEquipmentId.
  const coldDocs = await db.journalDocument.findMany({
    where: {
      organizationId: args.organizationId,
      status: "active",
      template: { code: "cold_equipment_control" },
      dateFrom: { lte: today },
      dateTo: { gte: threeDaysAgo },
    },
    select: { id: true, config: true },
  });
  if (coldDocs.length > 0) {
    const docEntries = await db.journalDocumentEntry.findMany({
      where: {
        documentId: { in: coldDocs.map((d) => d.id) },
        date: { gte: threeDaysAgo, lt: windowEnd },
      },
      select: { documentId: true, date: true, data: true },
    });
    const configByDoc = new Map<string, Map<string, string>>(); // docId -> configItemId -> equipmentId
    for (const doc of coldDocs) {
      const cfg = (doc.config ?? {}) as {
        equipment?: Array<{ id?: string; sourceEquipmentId?: string | null }>;
      };
      const map = new Map<string, string>();
      for (const item of cfg.equipment ?? []) {
        if (item.id && item.sourceEquipmentId) {
          map.set(item.id, item.sourceEquipmentId);
        }
      }
      configByDoc.set(doc.id, map);
    }
    for (const entry of docEntries) {
      const map = configByDoc.get(entry.documentId);
      if (!map) continue;
      const temps = (entry.data as { temperatures?: Record<string, unknown> } | null)
        ?.temperatures;
      if (!temps || typeof temps !== "object") continue;
      const dateKey = entry.date.toISOString().slice(0, 10);
      for (const [configItemId, rawValue] of Object.entries(temps)) {
        const equipmentId = map.get(configItemId);
        if (!equipmentId) continue;
        if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) continue;
        const list = readingsByEquipment.get(equipmentId) ?? [];
        list.push({ date: dateKey, temperature: rawValue });
        readingsByEquipment.set(equipmentId, list);
      }
    }
  }

  const summary: CapaSummary = {
    created: 0,
    skippedExisting: 0,
    candidates: 0,
    details: [],
  };

  // Which 3 consecutive days are we checking? d-2, d-1, d (today).
  const requiredDays = new Set<string>();
  for (let offset = 0; offset <= 2; offset++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - offset);
    requiredDays.add(d.toISOString().slice(0, 10));
  }

  // Lazy-load manager — only when we actually need to create a ticket.
  // Точки (2026-11-01): ответственный — руководитель точки оборудования.
  const managerByPoint = new Map<string, string | null>();
  let onDutyManagementIds: string[] | undefined;

  for (const equip of equipmentList) {
    const readings = readingsByEquipment.get(equip.id) ?? [];
    if (readings.length === 0) continue;

    // Per day: was there AT LEAST one out-of-range reading?
    const offendingDays = new Set<string>();
    for (const r of readings) {
      const belowMin = equip.tempMin != null && r.temperature < equip.tempMin;
      const aboveMax = equip.tempMax != null && r.temperature > equip.tempMax;
      if (belowMin || aboveMax) offendingDays.add(r.date);
    }
    const qualifies = [...requiredDays].every((d) => offendingDays.has(d));
    if (!qualifies) continue;

    summary.candidates += 1;

    const existing = await db.capaTicket.findFirst({
      where: {
        organizationId: args.organizationId,
        sourceType: SOURCE_TYPE,
        sourceEntryId: equip.id,
        status: { not: "closed" },
      },
      select: { id: true },
    });
    if (existing) {
      summary.skippedExisting += 1;
      summary.details.push({
        equipmentId: equip.id,
        equipmentName: equip.name,
        ticketId: existing.id,
        skipped: "already-open",
      });
      continue;
    }

    const pointId = equip.area.buildingId ?? null;
    if (!managerByPoint.has(pointId ?? "")) {
      // Сначала пытаемся назначить на дежурного из руководства сегодня —
      // чтобы CAPA «проверить компрессор» упала не Иванову на 7-дневной
      // болезни, а тому, кто реально в смене. Если в workShift никого
      // из management-категории на сегодня нет, фолбэчимся на первого
      // активного менеджера в организации. С точкой — только люди,
      // работающие на точке оборудования; нет таких — как раньше.
      onDutyManagementIds ??= (await listOnDutyToday(args.organizationId, now))
        .filter((user) => user.categoryKey === "management")
        .map((user) => user.userId);
      const findManager = (where: Record<string, unknown>) =>
        db.user.findFirst({
          where: { organizationId: args.organizationId, isActive: true, ...where },
          select: { id: true },
        });
      const managerRoles = { role: { in: getDbRoleValuesWithLegacy(MANAGER_ROLES) } };
      const atPoint = staffAtBuildingWhere(pointId);
      const picked =
        (onDutyManagementIds.length > 0 ? await findManager({ id: { in: onDutyManagementIds }, ...atPoint }) : null) ??
        (pointId ? await findManager({ ...managerRoles, ...atPoint }) : null) ??
        (onDutyManagementIds.length > 0 ? await findManager({ id: { in: onDutyManagementIds } }) : null) ??
        (await findManager(managerRoles));
      managerByPoint.set(pointId ?? "", picked?.id ?? null);
    }
    const managerId = managerByPoint.get(pointId ?? "") ?? null;
    if (!managerId) {
      summary.details.push({
        equipmentId: equip.id,
        equipmentName: equip.name,
        skipped: "no-manager",
      });
      continue;
    }

    const rangeSuffix = [
      equip.tempMin != null ? `от ${equip.tempMin}` : "",
      equip.tempMax != null ? `до ${equip.tempMax}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const dueDate = new Date(now);
    dueDate.setUTCHours(dueDate.getUTCHours() + 24);

    const ticket = await db.capaTicket.create({
      data: {
        organizationId: args.organizationId,
        buildingId: pointId,
        title: `Проверить «${equip.name}» — отклонения температуры 3 дня подряд`,
        description:
          `Автоматически создано WeSetup: температурный режим «${equip.name}» ` +
          `был вне нормы (${rangeSuffix}°C) три дня подряд. ` +
          `Рекомендуется проверить компрессор, герметичность двери, датчик и загрузку.`,
        priority: "high",
        status: "open",
        category: "temperature",
        sourceType: SOURCE_TYPE,
        sourceEntryId: equip.id,
        assignedToId: managerId,
        dueDate,
        slaHours: 24,
        rootCause: "",
        correctiveAction:
          "1. Проверить компрессор и работу вентилятора испарителя.\n" +
          "2. Убедиться, что дверь плотно закрывается, уплотнитель цел.\n" +
          "3. Сверить показания датчика с контрольным термометром.\n" +
          "4. Если отклонение сохраняется — вызвать сервис по холодильному оборудованию.",
        preventiveAction:
          "Добавить оборудование в график планового ТО, проверять уплотнители ежемесячно.",
        createdById: managerId,
      },
      select: { id: true },
    });

    summary.created += 1;
    summary.details.push({
      equipmentId: equip.id,
      equipmentName: equip.name,
      ticketId: ticket.id,
    });
  }

  return summary;
}
