import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { dispatchWebhooks } from "@/lib/webhook-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * K10-test — отправляет test-event на все настроенные webhook URLs.
 * Менеджер настраивает URL в /settings/integrations → жмёт «Тест» →
 * мы шлём `event="webhook.test"` payload и возвращаем число
 * webhooks которые получили запрос.
 *
 * Не ждёт ответа от URL'ов — fire-and-forget. Возвращает count.
 *
 * POST /api/settings/webhooks/test
 */
export async function POST() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { webhookUrls: true, name: true },
  });
  const urls = (org?.webhookUrls ?? []).length;
  if (urls === 0) {
    return NextResponse.json(
      { error: "Нет настроенных webhook URLs" },
      { status: 400 }
    );
  }

  await dispatchWebhooks(orgId, "webhook.test", {
    note: "Это тестовое событие из WeSetup",
    organizationName: org?.name,
    sentBy: auth.session.user.name ?? auth.session.user.email,
  });

  return NextResponse.json({
    ok: true,
    sentTo: urls,
    message: `Test-event отправлен на ${urls} URL${urls === 1 ? "" : "ов"}`,
  });
}
