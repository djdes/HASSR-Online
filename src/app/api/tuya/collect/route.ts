import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  processTemperatureReading,
  subjectKeyForEquipment,
} from "@/lib/temperature-deviations";
import { getDeviceTemperature } from "@/lib/tuya";
import { getDbRoleValuesWithLegacy, MANAGER_ROLES } from "@/lib/user-roles";
import {
  autofillColdEquipmentReading,
  autofillClimateReading,
} from "@/lib/iot-auto-fill";
import { detectTemperatureCapas } from "@/lib/capa-auto-detect";
import { timingSafeEqualStrings } from "@/lib/timing-safe";
import { hasPlanFeature } from "@/lib/billing.server";
import { pickPointSigner } from "@/lib/sensor-point";

export async function POST(request: Request) {
  try {
    // Verify cron secret to prevent unauthorized calls (constant-time).
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get("secret");

    if (!timingSafeEqualStrings(secret, process.env.TUYA_CRON_SECRET)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Find all equipment with linked Tuya devices
    const equipmentList = await db.equipment.findMany({
      where: { tuyaDeviceId: { not: null } },
      include: {
        area: {
          include: { organization: true },
        },
      },
    });

    if (equipmentList.length === 0) {
      return NextResponse.json({ message: "No Tuya devices linked", collected: 0 });
    }

    // Get the temp_control template
    const template = await db.journalTemplate.findUnique({
      where: { code: "temp_control" },
    });

    if (!template) {
      return NextResponse.json(
        { error: "temp_control template not found" },
        { status: 500 }
      );
    }

    const results: Array<{
      equipmentId: string;
      equipmentName: string;
      temperature: number;
      humidity: number | null;
      entryId: string;
      docsTouched?: number;
      alert: boolean;
    }> = [];
    const errors: Array<{ equipmentId: string; error: string }> = [];
    // IoT-датчики — возможность «Премиума» (и пробного): без неё не опрашиваем.
    const connectByOrg = new Map<string, boolean>();
    let lockedByPlan = 0;
    // Руководство организации — один запрос на организацию; автор записи —
    // руководитель точки оборудования (2026-11-01), а не первый попавшийся.
    type Manager = { id: string; role: string; name: string; email: string | null; buildingIds: string[] };
    const managersByOrg = new Map<string, Manager[]>();

    for (const equip of equipmentList) {
      const orgId = equip.area.organizationId;
      if (!connectByOrg.has(orgId)) connectByOrg.set(orgId, await hasPlanFeature(orgId, "equipmentConnect"));
      if (!connectByOrg.get(orgId)) {
        lockedByPlan += 1;
        continue;
      }
      try {
        const { temperature, humidity } = await getDeviceTemperature(
          equip.tuyaDeviceId!
        );

        // Автор записи — руководитель точки оборудования (цех без точки —
        // любой руководитель организации, как раньше).
        let managers = managersByOrg.get(orgId);
        if (!managers) {
          managers = await db.user.findMany({
            where: {
              organizationId: orgId,
              role: { in: getDbRoleValuesWithLegacy(MANAGER_ROLES) },
              isActive: true,
            },
            orderBy: { createdAt: "asc" },
            select: { id: true, role: true, name: true, email: true, buildingIds: true },
          });
          managersByOrg.set(orgId, managers);
        }
        const systemUser = pickPointSigner(managers, equip.area.buildingId ?? null);

        if (!systemUser) {
          errors.push({
            equipmentId: equip.id,
            error: "No active owner in organization",
          });
          continue;
        }

        const isOutOfRange =
          (equip.tempMin != null && temperature < equip.tempMin) ||
          (equip.tempMax != null && temperature > equip.tempMax);

        // Create journal entry
        const entry = await db.journalEntry.create({
          data: {
            templateId: template.id,
            organizationId: equip.area.organizationId,
            filledById: systemUser.id,
            areaId: equip.areaId,
            equipmentId: equip.id,
            data: {
              temperature,
              humidity,
              isWithinNorm: !isOutOfRange,
              source: "tuya_auto",
              tuyaDeviceId: equip.tuyaDeviceId,
            },
            status: "submitted",
          },
        });

        // Mirror the reading into the modern grid journals so the
        // today-compliance ring picks it up and workers don't have to
        // hand-copy values from Tuya into the cold-equipment document.
        // Failures here are non-fatal — the legacy JournalEntry above
        // is already committed and notifications still fire.
        let docsTouched = 0;
        try {
          docsTouched += await autofillColdEquipmentReading({
            organizationId: equip.area.organizationId,
            equipmentId: equip.id,
            temperature,
            systemUserId: systemUser.id,
          });
          docsTouched += await autofillClimateReading({
            organizationId: equip.area.organizationId,
            equipmentId: equip.id,
            temperature,
            humidity,
            systemUserId: systemUser.id,
          });
        } catch (err) {
          console.error(
            `[tuya/collect] doc auto-fill failed for ${equip.id}`,
            err
          );
        }

        results.push({
          equipmentId: equip.id,
          equipmentName: equip.name,
          temperature,
          humidity,
          entryId: entry.id,
          docsTouched,
          alert: isOutOfRange,
        });

        // Отклонение → инцидент: адресно ответственному за журнал,
        // руководству — только если он не исправит вовремя. Раньше
        // каждое показание слало пуш всем управляющим сразу.
        await processTemperatureReading({
          organizationId: equip.area.organizationId,
          subjectKey: subjectKeyForEquipment(equip.id),
          subjectName: equip.name,
          value: temperature,
          tempMin: equip.tempMin,
          tempMax: equip.tempMax,
          equipmentId: equip.id,
          source: "IoT-датчик (авто)",
          areaName: equip.area.name,
        });
      } catch (err) {
        errors.push({
          equipmentId: equip.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // After collecting readings, scan each org that had any violation
    // today for 3-consecutive-day patterns and open CAPA tickets.
    // Grouped by org so each org gets at most one detector sweep.
    const orgsWithAlerts = new Set<string>();
    for (const equip of equipmentList) {
      const resultForEquip = results.find((r) => r.equipmentId === equip.id);
      if (resultForEquip?.alert) {
        orgsWithAlerts.add(equip.area.organizationId);
      }
    }
    const capaSummaries: Array<{
      organizationId: string;
      created: number;
      skippedExisting: number;
      candidates: number;
    }> = [];
    for (const orgId of orgsWithAlerts) {
      try {
        const capa = await detectTemperatureCapas({ organizationId: orgId });
        capaSummaries.push({
          organizationId: orgId,
          created: capa.created,
          skippedExisting: capa.skippedExisting,
          candidates: capa.candidates,
        });
      } catch (err) {
        console.error(
          `[tuya/collect] CAPA detect failed for org ${orgId}`,
          err
        );
      }
    }

    if (lockedByPlan > 0) console.info("[tuya/collect] skipped: plan without IoT", { lockedByPlan });
    return NextResponse.json({
      collected: results.length,
      errors: errors.length,
      lockedByPlan,
      results,
      errorDetails: errors,
      capa: capaSummaries,
    });
  } catch (error) {
    console.error("Tuya collect error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
