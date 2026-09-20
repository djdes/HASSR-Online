import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
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

  const updated = await db.organization.update({
    where: { id: getActiveOrgId(session) },
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

  return NextResponse.json({ ok: true, organization: updated });
}
