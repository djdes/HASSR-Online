import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  MAX_ESCALATION_MINUTES,
  MIN_ESCALATION_MINUTES,
} from "@/lib/temperature-deviations";
import type { ReadingPhotoPatch } from "@/lib/reading-photo-fixation";
import { getReadingPhotoSettings, updateReadingPhotoSettings } from "@/lib/reading-photo-fixation.server";

/**
 * PATCH /api/settings/compliance
 *
 * Body: { requireAdminForJournalEdit?: boolean, shiftEndHour?: number,
 *         lockPastDayEdits?: boolean, requirePhotoOnTaskFillStep?: boolean,
 *         escalateDeviationsToManagement?: boolean,
 *         deviationEscalationMinutes?: number,
 *         readingPhotoEnabled?: boolean, readingPhotoRequired?: boolean }
 *
 * `readingPhoto*` — «Фотофиксация показаний» QR-форм холодильника и склада
 * (2026-09-27): хранится не в колонке, а строкой `PlatformSetting`
 * (`reading-photo-fixation.ts`); в ответе — `readingPhoto: { enabled, required }`.
 *
 * Management-only. Updates the org-wide compliance toggles (currently
 * just one flag — gating who can re-open a completed journal task). We
 * accept a partial body so future flags can be added without breaking
 * older clients.
 */
export async function PATCH(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        requireAdminForJournalEdit?: unknown;
        shiftEndHour?: unknown;
        lockPastDayEdits?: unknown;
        requirePhotoOnTaskFillStep?: unknown;
        escalateDeviationsToManagement?: unknown;
        deviationEscalationMinutes?: unknown;
        qrFillMode?: unknown;
        healthQrRequired?: unknown;
        readingPhotoEnabled?: unknown;
        readingPhotoRequired?: unknown;
      }
    | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const data: {
    requireAdminForJournalEdit?: boolean;
    shiftEndHour?: number;
    lockPastDayEdits?: boolean;
    requirePhotoOnTaskFillStep?: boolean;
    escalateDeviationsToManagement?: boolean;
    deviationEscalationMinutes?: number;
    qrFillMode?: string;
    healthQrRequired?: boolean;
  } = {};
  if (typeof body.healthQrRequired === "boolean") {
    data.healthQrRequired = body.healthQrRequired;
  }
  if (body.qrFillMode !== undefined) {
    if (body.qrFillMode !== "public" && body.qrFillMode !== "pin" && body.qrFillMode !== "auth") {
      return NextResponse.json({ error: "qrFillMode: public | pin | auth" }, { status: 400 });
    }
    data.qrFillMode = body.qrFillMode;
  }
  if (typeof body.requireAdminForJournalEdit === "boolean") {
    data.requireAdminForJournalEdit = body.requireAdminForJournalEdit;
  }
  if (typeof body.shiftEndHour === "number") {
    const h = Math.floor(body.shiftEndHour);
    if (h < 0 || h > 23) {
      return NextResponse.json(
        { error: "shiftEndHour должен быть от 0 до 23" },
        { status: 400 }
      );
    }
    data.shiftEndHour = h;
  }
  if (typeof body.lockPastDayEdits === "boolean") {
    data.lockPastDayEdits = body.lockPastDayEdits;
  }
  if (typeof body.requirePhotoOnTaskFillStep === "boolean") {
    data.requirePhotoOnTaskFillStep = body.requirePhotoOnTaskFillStep;
  }
  if (typeof body.escalateDeviationsToManagement === "boolean") {
    data.escalateDeviationsToManagement = body.escalateDeviationsToManagement;
  }
  if (typeof body.deviationEscalationMinutes === "number") {
    const minutes = Math.floor(body.deviationEscalationMinutes);
    if (minutes < MIN_ESCALATION_MINUTES || minutes > MAX_ESCALATION_MINUTES) {
      return NextResponse.json(
        {
          error: `Время ожидания должно быть от ${MIN_ESCALATION_MINUTES} до ${MAX_ESCALATION_MINUTES} минут`,
        },
        { status: 400 }
      );
    }
    data.deviationEscalationMinutes = minutes;
  }
  const readingPhotoPatch: ReadingPhotoPatch = {};
  if (typeof body.readingPhotoEnabled === "boolean") readingPhotoPatch.enabled = body.readingPhotoEnabled;
  if (typeof body.readingPhotoRequired === "boolean") readingPhotoPatch.required = body.readingPhotoRequired;
  const hasReadingPhotoPatch = Object.keys(readingPhotoPatch).length > 0;

  if (Object.keys(data).length === 0 && !hasReadingPhotoPatch) {
    return NextResponse.json(
      { error: "Нет полей для обновления" },
      { status: 400 }
    );
  }

  const orgId = getActiveOrgId(session);
  const select = {
    requireAdminForJournalEdit: true,
    shiftEndHour: true,
    lockPastDayEdits: true,
    requirePhotoOnTaskFillStep: true,
    escalateDeviationsToManagement: true,
    deviationEscalationMinutes: true,
  } as const;
  const updated =
    Object.keys(data).length > 0
      ? await db.organization.update({ where: { id: orgId }, data, select })
      : await db.organization.findUnique({ where: { id: orgId }, select });

  const readingPhoto = hasReadingPhotoPatch
    ? await updateReadingPhotoSettings(orgId, readingPhotoPatch)
    : await getReadingPhotoSettings(orgId);
  if (hasReadingPhotoPatch) {
    console.info(
      `[reading-photo] settings org=${orgId} user=${session.user.id} enabled=${readingPhoto.enabled ? 1 : 0} required=${readingPhoto.required ? 1 : 0}`
    );
  }

  return NextResponse.json({ ...updated, readingPhoto });
}
