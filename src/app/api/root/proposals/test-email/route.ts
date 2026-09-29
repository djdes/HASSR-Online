import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { isEmailDeliveryConfigured, sendRawEmail } from "@/lib/email";
import { readDefaultProposalSender } from "@/lib/proposal/context.server";
import {
  PLATFORM_ORG_ID,
  PROPOSAL_AUDIT_ENTITY,
  buildProposalPreview,
  proposalAuditDetails,
  proposalFormSchema,
  resolveProposalForm,
} from "@/lib/proposal/root.server";
import { proposalAppOrigin } from "@/lib/proposal/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/root/proposals/test-email — письмо с КП на почту текущего ROOT.
 * Без SMTP (рабочая копия, `SMTP_HOST=""`) письмо не уходит — `sendRawEmail`
 * пишет его в лог сервера, ответ говорит об этом прямо.
 */
export async function POST(request: Request) {
  const session = await requireRoot();
  const to = session.user.email?.trim();
  if (!to) return NextResponse.json({ error: "У вашего аккаунта нет почты" }, { status: 400 });
  const parsed = proposalFormSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  }
  const resolved = await resolveProposalForm(parsed.data, { sender: await readDefaultProposalSender() });
  const preview = await buildProposalPreview(resolved, proposalAppOrigin());
  const configured = isEmailDeliveryConfigured();
  const subject = `[тест] ${preview.email.subject}`;
  const sent = await sendRawEmail(to, subject, preview.email.html);
  console.info(
    `[kp] root test email to=${to} sphere=${resolved.vars.sphere} promo=${resolved.vars.promo?.code ?? "-"} delivery=${configured ? "smtp" : "log"} sent=${sent ? "yes" : "no"} html=${preview.email.bytes}B`,
  );
  await recordAuditLog({
    request,
    session,
    organizationId: PLATFORM_ORG_ID,
    action: "proposal.test_email",
    entity: PROPOSAL_AUDIT_ENTITY,
    entityId: resolved.vars.promo?.code ?? resolved.vars.sphere,
    details: { ...proposalAuditDetails(resolved.vars), to, delivery: configured ? "smtp" : "log", sent },
  });
  if (configured && !sent) {
    return NextResponse.json({ error: "Письмо не отправилось — подробности в логе сервера" }, { status: 502 });
  }
  return NextResponse.json({ to, delivery: configured ? "smtp" : "log", sent });
}
