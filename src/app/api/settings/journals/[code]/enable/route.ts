import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { JOURNAL_ENABLE_AUDIT_ACTION, blankSignupJournal, type JournalEnableSource } from "@/lib/blank-signup";
import { getDisabledJournalCodes, setDisabledJournalCodes } from "@/lib/disabled-journals";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/journals/<код>/enable — «Включить журнал» одним нажатием
 * на экране «Этот журнал отключён» (в том числе когда человек пришёл по QR
 * со скачанного шаблона, `?from=qb`).
 *
 * Права — те же, что у «Набора журналов» (руководитель). В отличие от PATCH
 * всего списка здесь дельта: убираем из выключенных ровно этот журнал, чужие
 * изменения из другой вкладки не затираются. Каждое включение — в AuditLog.
 *
 * Тело (необязательно): `{ source: "blank-qr" | "journal-page" }`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;
  if (!hasFullWorkspaceAccess(session.user)) {
    return NextResponse.json({ error: "Включить журнал может руководитель" }, { status: 403 });
  }

  const { code: rawCode } = await params;
  const code = blankSignupJournal(rawCode);
  if (!code) return NextResponse.json({ error: "Журнал не найден" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { source?: unknown } | null;
  const source: JournalEnableSource = body?.source === "blank-qr" ? "blank-qr" : "journal-page";

  const organizationId = getActiveOrgId(session);
  const disabled = await getDisabledJournalCodes(organizationId);
  if (!disabled.has(code)) return NextResponse.json({ ok: true, changed: false });

  await setDisabledJournalCodes(
    organizationId,
    [...disabled].filter((item) => item !== code),
  );
  await recordAuditLog({
    request,
    session,
    organizationId,
    action: JOURNAL_ENABLE_AUDIT_ACTION,
    entity: "JournalTemplate",
    entityId: code,
    details: { journalCode: code, via: source },
  });
  console.info("[journals] enabled by one tap", { organizationId, code, source });
  return NextResponse.json({ ok: true, changed: true });
}
