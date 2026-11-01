import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  processTemperatureReading,
  subjectKeyForEquipment,
} from "@/lib/temperature-deviations";
import { checkCronSecret } from "@/lib/cron-auth";
import { getDeviceTemperature } from "@/lib/tuya";
import { maybeCreateRealtimeCapa } from "@/lib/iot-violation-capa";
import { buildingWhere } from "@/lib/building-scope";
import { pickPointSigner, pickSensorDocuments, sensorRowKeys } from "@/lib/sensor-point";
import { hasPlanFeature } from "@/lib/billing.server";
import { loadOrgJournalOverrides, withOrgJournalOverride, type OrgJournalOverride } from "@/lib/org-journal-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hourly cron: pull current temperature/humidity from every Tuya-paired
 * Equipment and write it into the corresponding journal entry — without
 * any worker filling forms.
 *
 *   GET/POST /api/cron/tuya-pull?secret=$CRON_SECRET
 *
 * Flow:
 *   1. Find all Equipment.tuyaDeviceId != null + at least one
 *      EquipmentSensorMapping with template.fillMode = "sensor".
 *   2. Group by organizationId for batch processing.
 *   3. For each org, walk equipment list:
 *        - Pull current temp/humidity from Tuya
 *        - For each mapping (templateId, fieldKey, readingType):
 *            - Find active JournalDocuments covering today at the
 *              equipment's point (Equipment.area.buildingId): documents
 *              that list the equipment, else the point's own / shared
 *              one — never another point's (src/lib/sensor-point.ts)
 *            - Upsert daily entry attributed to that point's manager
 *              (one entry per doc/manager/date — values merged into
 *              data.temperatures[rowId] for cold_equipment_control,
 *              data.measurements[roomId][nearestTime] for climate_control)
 *        - Update mapping.lastReadingAt + lastValue
 *
 * Errors per device are isolated — one Tuya 5xx doesn't stop the run.
 *
 * For now we support cold_equipment_control journal directly. climate_control
 * support follows the same pattern, fanning into the nearest controlTime
 * slot. Other templates with fillMode=sensor get logged but skipped.
 */

const COLD_EQUIPMENT_CODE = "cold_equipment_control";
const CLIMATE_CODE = "climate_control";

type RunReport = {
  organizationsTouched: number;
  equipmentsChecked: number;
  tuyaErrors: number;
  entriesWritten: number;
  mappingsUpdated: number;
  skipped: number;
  /** Тариф без IoT (не «Премиум» и не пробный) — не опрашиваем. */
  lockedByPlan: number;
};

function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

function nearestControlTime(now: Date, controlTimes: string[]): string | null {
  if (controlTimes.length === 0) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let best = controlTimes[0];
  let bestDelta = Infinity;
  for (const t of controlTimes) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) continue;
    const slot = Number(m[1]) * 60 + Number(m[2]);
    const delta = Math.abs(slot - nowMin);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = t;
    }
  }
  return best;
}

async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const now = new Date();
  const todayStart = utcDayStart(now);
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

  const report: RunReport = {
    organizationsTouched: 0,
    equipmentsChecked: 0,
    tuyaErrors: 0,
    entriesWritten: 0,
    mappingsUpdated: 0,
    skipped: 0,
    lockedByPlan: 0,
  };

  // Pull all Tuya-paired equipment with their sensor mappings + the area's
  // organization for scoping. Single batch query for efficiency.
  const equipments = await db.equipment.findMany({
    where: {
      tuyaDeviceId: { not: null },
      sensorMappings: { some: {} },
    },
    select: {
      id: true,
      name: true,
      tuyaDeviceId: true,
      tempMin: true,
      tempMax: true,
      area: { select: { organizationId: true, buildingId: true } },
      sensorMappings: {
        select: {
          id: true,
          templateId: true,
          fieldKey: true,
          readingType: true,
          lastReadingAt: true,
          lastValue: true,
          template: {
            select: { code: true, fillMode: true, id: true },
          },
        },
      },
    },
  });

  const orgsTouched = new Set<string>();
  // Подписант записи датчика — человек точки документа (2026-11-01):
  // раньше первый руководитель организации, то есть и чужой точки.
  type SignerCandidate = { id: string; role: string; name: string; email: string | null; buildingIds: string[] };
  const usersByOrg = new Map<string, SignerCandidate[]>();
  const signerFor = async (orgId: string, buildingId: string | null): Promise<string | null> => {
    let users = usersByOrg.get(orgId);
    if (!users) {
      users = await db.user.findMany({
        where: { organizationId: orgId, isActive: true },
        select: { id: true, role: true, name: true, email: true, buildingIds: true },
      });
      usersByOrg.set(orgId, users);
    }
    return pickPointSigner(users, buildingId)?.id ?? null;
  };
  // IoT-датчики — возможность «Премиума» (и пробного): без неё не опрашиваем.
  const connectByOrg = new Map<string, boolean>();
  const overridesByOrg = new Map<string, Map<string, OrgJournalOverride>>();

  for (const eq of equipments) {
    const orgId = eq.area.organizationId;
    if (!eq.tuyaDeviceId) continue;
    if (!connectByOrg.has(orgId)) connectByOrg.set(orgId, await hasPlanFeature(orgId, "equipmentConnect"));
    if (!connectByOrg.get(orgId)) {
      report.lockedByPlan += 1;
      continue;
    }

    // Skip equipment whose mappings are all on non-sensor templates
    // (распределение — своё у организации, `OrganizationJournalSetting`).
    if (!overridesByOrg.has(orgId)) overridesByOrg.set(orgId, await loadOrgJournalOverrides(orgId));
    const overrides = overridesByOrg.get(orgId);
    const activeMappings = eq.sensorMappings.filter(
      (m) => withOrgJournalOverride(m.template, overrides?.get(m.template.id)).fillMode === "sensor"
    );
    if (activeMappings.length === 0) {
      report.skipped += 1;
      continue;
    }

    let reading: Awaited<ReturnType<typeof getDeviceTemperature>>;
    try {
      reading = await getDeviceTemperature(eq.tuyaDeviceId);
    } catch (err) {
      report.tuyaErrors += 1;
      console.warn(
        `[tuya-pull] device ${eq.tuyaDeviceId} (${eq.name}) failed:`,
        err instanceof Error ? err.message : err
      );
      continue;
    }
    report.equipmentsChecked += 1;
    orgsTouched.add(orgId);

    const pointId = eq.area.buildingId ?? null;

    // For each mapping, find the active document and write the value.
    for (const mapping of activeMappings) {
      const tplCode = mapping.template.code;
      // Pick the value based on readingType.
      const value =
        mapping.readingType === "humidity"
          ? reading.humidity
          : reading.temperature;
      if (value === null || value === undefined) {
        continue;
      }

      // Документы точки оборудования и общие; чужая точка не подходит.
      const candidates = await db.journalDocument.findMany({
        where: {
          organizationId: orgId,
          templateId: mapping.templateId,
          status: "active",
          dateFrom: { lte: todayStart },
          dateTo: { gte: todayStart },
          ...buildingWhere(pointId),
        },
        orderBy: { dateFrom: "desc" },
        select: { id: true, buildingId: true, config: true },
      });
      const rowList = tplCode === CLIMATE_CODE ? "rooms" : "equipment";
      const targets = pickSensorDocuments(candidates, {
        pointId,
        rowKeys: (candidate) => sensorRowKeys(candidate.config, eq.id, rowList),
      });
      if (targets.length === 0) continue;

      let wrote = false;
      for (const { doc, keys } of targets) {
        const managerId = await signerFor(orgId, doc.buildingId);
        if (!managerId) {
          report.skipped += 1;
          continue;
        }
        // Строки документа для этого оборудования; документ без такой
        // строки — запись по id оборудования, как раньше.
        const rowKeys = keys.length > 0 ? keys : [eq.id];

        // Merge value into existing entry data (per-template shape).
        const existing = await db.journalDocumentEntry.findUnique({
          where: {
            documentId_employeeId_date: {
              documentId: doc.id,
              employeeId: managerId,
              date: todayStart,
            },
          },
          select: { data: true },
        });
        const baseDataRaw = (existing?.data as Record<string, unknown>) ?? {};
        // Снимаем _autoSeeded маркер — мы пишем реальные данные с
        // IoT-датчика. Если оставить, NOT_AUTO_SEEDED фильтр
        // (дашборд / отчёты / weekly-digest / auto-pause) продолжит
        // считать строку placeholder'ом и не покажет sensor-fill'ы.
        const { _autoSeeded: _seeded, ...baseData } = baseDataRaw;
        void _seeded;
        let nextData: Record<string, unknown> = baseData;

        if (tplCode === COLD_EQUIPMENT_CODE) {
          const prevTemps =
            (baseData.temperatures as Record<string, unknown> | undefined) ?? {};
          const statuses =
            (baseData.statuses as Record<string, unknown> | undefined) ?? {};
          const temperatures: Record<string, unknown> = { ...prevTemps };
          // Холодильник на обслуживании/в ремонте («обсл»/«рем») — датчик не пишет поверх отметки.
          for (const key of rowKeys) if (!statuses[key]) temperatures[key] = value;
          nextData = { ...baseData, temperatures };
        } else if (tplCode === CLIMATE_CODE) {
          const cfg = (doc.config as { controlTimes?: unknown }) ?? {};
          const controlTimes = Array.isArray(cfg.controlTimes)
            ? (cfg.controlTimes as unknown[]).filter(
                (t): t is string => typeof t === "string"
              )
            : [];
          const slot = nearestControlTime(now, controlTimes);
          if (!slot) continue;
          const measurements: Record<string, Record<string, Record<string, unknown>>> = {
            ...((baseData.measurements as
              | Record<string, Record<string, Record<string, unknown>>>
              | undefined) ?? {}),
          };
          for (const key of rowKeys) {
            const prevRoom = measurements[key] ?? {};
            const prevSlot = prevRoom[slot] ?? {};
            measurements[key] = {
              ...prevRoom,
              [slot]: { ...prevSlot, [mapping.readingType]: value },
            };
          }
          nextData = { ...baseData, measurements };
        } else {
          // Other sensor-fill templates not yet supported — log and skip.
          console.info(
            `[tuya-pull] skipping unsupported template ${tplCode}`
          );
          continue;
        }

        const dataValue = nextData as Prisma.InputJsonValue;
        await db.journalDocumentEntry.upsert({
          where: {
            documentId_employeeId_date: {
              documentId: doc.id,
              employeeId: managerId,
              date: todayStart,
            },
          },
          create: {
            documentId: doc.id,
            employeeId: managerId,
            date: todayStart,
            data: dataValue,
          },
          update: { data: dataValue },
        });
        report.entriesWritten += 1;
        wrote = true;
      }
      if (!wrote) continue;

      // IoT-trigger → CAPA: до апдейта mapping.lastValue/lastReadingAt
      // мы знаем «предыдущий» замер. Если оба out-of-range и зазор
      // ≤90 мин — создаём тикет (см. src/lib/iot-violation-capa.ts).
      // Только для temperature-readings (humidity не имеет min/max).
      if (mapping.readingType === "temperature") {
        // Отклонение → инцидент. Раньше этот (основной) cron вообще
        // никого не уведомлял: алерт жил только в легаси tuya/collect.
        await processTemperatureReading({
          organizationId: orgId,
          subjectKey: subjectKeyForEquipment(eq.id),
          subjectName: eq.name,
          value,
          tempMin: eq.tempMin,
          tempMax: eq.tempMax,
          equipmentId: eq.id,
          source: "IoT-датчик (авто)",
          now,
        });
        const prevValue =
          mapping.lastValue !== null && mapping.lastValue !== undefined
            ? Number(mapping.lastValue)
            : null;
        maybeCreateRealtimeCapa({
          organizationId: orgId,
          equipmentId: eq.id,
          equipmentName: eq.name,
          currentValue: value,
          previousValue: Number.isFinite(prevValue) ? prevValue : null,
          previousAt: mapping.lastReadingAt,
          tempMin: eq.tempMin,
          tempMax: eq.tempMax,
          now,
        }).catch((err) => {
          console.warn(
            `[tuya-pull] capa-trigger failed for ${eq.name}:`,
            err instanceof Error ? err.message : err
          );
        });
      }

      await db.equipmentSensorMapping.update({
        where: { id: mapping.id },
        data: {
          lastReadingAt: now,
          lastValue: String(value),
        },
      });
      report.mappingsUpdated += 1;
    }
  }

  report.organizationsTouched = orgsTouched.size;
  return NextResponse.json({ ok: true, report });
}

export const GET = handle;
export const POST = handle;
