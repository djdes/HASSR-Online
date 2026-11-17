import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { loadBillingUnit, ownerContact, readTrialSettings, sendTrialReminderNow, stateForUnit } from "@/lib/billing.server";
import { db } from "@/lib/db";
import { resolveLocale } from "@/i18n/locales";
import { sendTrialFeedbackRequest } from "@/lib/trial-feedback.server";
import { sendWelcomeEmailOnce } from "@/lib/welcome-email.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ kind: z.enum(["welcome", "trial_reminder", "trial_feedback"]) });

/**
 * POST /api/root/organizations/[id]/service-emails `{ kind }` — служебное
 * письмо владельцу организации вручную (спека trial-emails-rename-2026-11):
 * приветственное, «пробный заканчивается», «удалось оценить журналы?».
 * Отправка — те же функции, что у автоматики, без проверки «уже отправляли».
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неизвестное письмо" }, { status: 400 });
  const kind = parsed.data.kind;
  const org = await db.organization.findUnique({ where: { id }, select: { id: true, name: true, locale: true } });
  if (!org) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  const owner = await ownerContact(id);
  if (!owner?.email) return NextResponse.json({ error: "У владельца нет почты", errorCode: "no_email" }, { status: 409 });
  const actor = { userId: session.user.id, userName: session.user.name ?? session.user.email ?? null };

  let sent = false;
  if (kind === "welcome") {
    const outcome = await sendWelcomeEmailOnce({
      to: owner.email,
      name: owner.name,
      hasAccount: true,
      organizationId: id,
      locale: resolveLocale({ organizationLocale: org.locale }),
      via: "manual",
      force: true,
      actor,
    });
    if (outcome === "suppressed") {
      return NextResponse.json({ error: "Адрес в списке подавления — письма на него не отправляются", errorCode: "suppressed" }, { status: 409 });
    }
    sent = outcome === "sent";
  } else if (kind === "trial_reminder") {
    const result = await sendTrialReminderNow(id);
    if (!result) return NextResponse.json({ error: "Пробный период сейчас не идёт", errorCode: "no_trial" }, { status: 409 });
    sent = result.sent;
  } else {
    const unit = await loadBillingUnit(id);
    const state = unit ? stateForUnit(unit, await readTrialSettings(), new Date()) : null;
    if (!unit || !state?.trialEndsAt) {
      return NextResponse.json({ error: "У организации нет пробного периода", errorCode: "no_trial" }, { status: 409 });
    }
    const result = await sendTrialFeedbackRequest({
      organizationId: id,
      organizationName: unit.organizationName,
      orgIds: unit.scopeOrgIds,
      trialStartedAt: unit.createdAt,
      trialEndsAt: state.trialEndsAt < new Date() ? state.trialEndsAt : new Date(),
      employees: unit.activeUsers,
      actor,
      manual: true,
    });
    sent = result.sent;
  }

  if (!sent) return NextResponse.json({ error: "Письмо не отправилось — проверьте почтовый сервер", errorCode: "send_failed" }, { status: 502 });
  await recordAuditLog({
    request,
    session,
    organizationId: id,
    action: `service_email.${kind}`,
    entity: "Organization",
    entityId: id,
    details: { to: owner.email, kind },
  });
  return NextResponse.json({ ok: true, to: owner.email });
}
