import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { CUSTOM_NAMES_AUDIT_ACTION, saveCustomNames } from "@/lib/custom-names-save";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * PUT /api/settings/custom-names
 *
 * Body: { journals: { <код>: "Своё" | "" }, sections: { <ключ>: "Своё" | "" } }
 *
 * Полный набор своих названий организации одной кнопкой «Сохранить» со
 * страницы «Настройки → Названия». Пустое значение — стандартное
 * название. Права, проверки и аудит — в `lib/custom-names-save.ts`.
 */
export async function PUT(request: Request) {
  return save(request, "replace");
}

/**
 * PATCH /api/settings/custom-names
 *
 * Body: { journals?: { <код>: "Своё" | "" }, sections?: { <ключ>: "Своё" | "" } }
 *
 * Только присланные названия поверх сохранённых — окно «Своё название
 * журнала» на странице журнала (пустое — «Вернуть стандартное»). Права,
 * проверки (2–80 символов, без повторов) и запись в журнал действий — те
 * же, что у PUT: один помощник `saveCustomNames`.
 */
export async function PATCH(request: Request) {
  return save(request, "merge");
}

async function save(request: Request, mode: "replace" | "merge") {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  const organizationId = getActiveOrgId(session);

  const body = await request.json().catch(() => null);
  const result = await saveCustomNames(
    { actor: session.user, organizationId, body, mode },
    {
      loadStored: async (id) =>
        (
          await db.organization.findUnique({
            where: { id },
            select: { customNamesJson: true },
          })
        )?.customNamesJson ?? null,
      listJournals: () =>
        db.journalTemplate.findMany({
          where: { isActive: true },
          select: { code: true, name: true },
        }),
      store: async (id, names) => {
        await db.organization.update({
          where: { id },
          data: { customNamesJson: names },
        });
      },
      audit: ({ organizationId: orgId, details }) =>
        recordAuditLog({
          request,
          session,
          organizationId: orgId,
          action: CUSTOM_NAMES_AUDIT_ACTION,
          entity: "organization",
          entityId: orgId,
          details,
        }),
    }
  );

  return NextResponse.json(result.body, { status: result.status });
}
