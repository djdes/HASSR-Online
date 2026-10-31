import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { authenticateExternalRequest } from "@/lib/external/auth";
import { readHrEmployeesBody } from "@/lib/hr1c/api-body";
import { runHrSync } from "@/lib/hr1c/sync.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/external/hr/employees — список сотрудников от обработки в 1С
 * (`Authorization: Bearer <токен организации>` из «Настройки → API»).
 *
 * Тело: `{ apply?: boolean, employees: [{ id, fullName, position?, hiredAt?,
 * dismissedAt?, archived?, phone? }] }`. Без `apply` применяется, только если
 * в «1С: кадры» включено автоприменение; иначе ответ — что изменилось бы.
 */
export async function POST(request: Request) {
  const auth = await authenticateExternalRequest(request);
  if (!auth.ok) return auth.response;
  if (auth.source !== "organization" || !auth.organizationId) {
    return NextResponse.json({ ok: false, error: "Нужен токен организации из «Настройки → API»" }, { status: 403 });
  }
  const parsed = readHrEmployeesBody(await request.json().catch(() => null));
  if (!parsed) return NextResponse.json({ ok: false, error: "Ожидается { employees: [{ id, fullName, … }] }" }, { status: 400 });
  const connection = await db.hrConnection.findUnique({
    where: { organizationId: auth.organizationId },
    select: { defaultPositionId: true, autoApply: true, createdById: true },
  });
  const apply = parsed.apply ?? connection?.autoApply ?? false;
  const result = await runHrSync({
    organizationId: auth.organizationId,
    employees: parsed.employees,
    mode: apply ? "apply" : "preview",
    defaultPositionId: connection?.defaultPositionId ?? null,
    actor: { id: connection?.createdById ?? null, name: "1С: ЗУП (API)" },
  });
  if (apply && connection) {
    await db.hrConnection.update({
      where: { organizationId: auth.organizationId },
      data: { lastSyncAt: new Date(), lastError: null, lastResult: { ...result.summary, errors: result.errors.length } },
    });
  }
  return NextResponse.json({ ok: true, ...result });
}
