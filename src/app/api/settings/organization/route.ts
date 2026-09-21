import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { recordAuditLog } from "@/lib/audit-log";
import {
  ORG_PROFILE_FIELDS,
  parseOrganizationProfilePatch,
} from "@/lib/organization-profile-patch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/settings/organization
 *
 * Управление общими полями организации (в одной ручке, чтобы форма
 * /settings/organization могла сохранять всё разом без зоопарка
 * endpoint'ов). Принимаем partial — обновляем только заполненные поля.
 *
 * Разбор и проверка полей — в `@/lib/organization-profile-patch`: те же
 * правила применяет консультант, когда правит реквизиты клиента со своей
 * карточки. Раньше проверки жили прямо здесь, и второй потребитель
 * неизбежно завёл бы свои.
 *
 * Поля, требующие отдельного flow (платежи, секреты, токены), здесь
 * НЕ принимаем. Они в своих специализированных endpoint'ах:
 *   • externalApiToken → /api/settings/external-token
 *   • yandexDiskToken / accountantEmail → отдельные endpoints
 *   • subscriptionPlan / subscriptionEnd → /api/billing
 *   • requireAdminForJournalEdit / shiftEndHour / lockPastDayEdits →
 *     /api/settings/compliance (оставляем там для back-compat)
 */
export async function PATCH(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const parsed = parseOrganizationProfilePatch(body, ORG_PROFILE_FIELDS);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const data = parsed.data;
  const organizationId = getActiveOrgId(session);

  // Снимок «до» — только по меняемым полям, для журнала действий.
  const changedKeys = Object.keys(data);
  const before =
    changedKeys.length > 0
      ? ((await db.organization.findUnique({
          where: { id: organizationId },
          select: Object.fromEntries(changedKeys.map((key) => [key, true])),
        })) as Record<string, unknown> | null)
      : null;

  const updated = await db.organization.update({
    where: { id: organizationId },
    data,
    select: {
      name: true,
      journalShortName: true,
      type: true,
      ownershipKind: true,
      locationsCount: true,
      inn: true,
      address: true,
      phone: true,
      accountantEmail: true,
      locale: true,
      timezone: true,
      brandColor: true,
      logoUrl: true,
      shiftEndHour: true,
      lockPastDayEdits: true,
      requireAdminForJournalEdit: true,
    },
  });

  // «Было → стало» по реально изменившимся полям: часовой пояс,
  // реквизиты, название для журналов и т.п.
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of changedKeys) {
    const from = auditScalar(before?.[key]);
    const to = auditScalar((data as Record<string, unknown>)[key]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changed[key] = { from, to };
  }
  if (Object.keys(changed).length > 0) {
    await recordAuditLog({
      request,
      session,
      organizationId,
      action: "organization.settings.update",
      entity: "organization",
      entityId: organizationId,
      details: { changed },
    });
  }

  return NextResponse.json({ ok: true, organization: updated });
}

function auditScalar(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value;
}
