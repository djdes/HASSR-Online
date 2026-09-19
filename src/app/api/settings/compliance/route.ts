import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  MAX_ESCALATION_MINUTES,
  MIN_ESCALATION_MINUTES,
} from "@/lib/temperature-deviations";

/**
 * PATCH /api/settings/compliance
 *
 * Body: { requireAdminForJournalEdit?: boolean, shiftEndHour?: number,
 *         lockPastDayEdits?: boolean, requirePhotoOnTaskFillStep?: boolean,
 *         escalateDeviationsToManagement?: boolean,
 *         deviationEscalationMinutes?: number }
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
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
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
  } = {};
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
  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Нет полей для обновления" },
      { status: 400 }
    );
  }

  const updated = await db.organization.update({
    where: { id: getActiveOrgId(session) },
    data,
    select: {
      requireAdminForJournalEdit: true,
      shiftEndHour: true,
      lockPastDayEdits: true,
      requirePhotoOnTaskFillStep: true,
      escalateDeviationsToManagement: true,
      deviationEscalationMinutes: true,
    },
  });

  return NextResponse.json(updated);
}
