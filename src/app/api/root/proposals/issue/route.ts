import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import { readDefaultProposalSender } from "@/lib/proposal/context.server";
import {
  PLATFORM_ORG_ID,
  PROPOSAL_AUDIT_ENTITY,
  proposalAuditDetails,
  proposalFormSchema,
  resolveProposalForm,
} from "@/lib/proposal/root.server";
import { proposalAppOrigin, proposalPdfUrl, signProposalToken } from "@/lib/proposal/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["pdf", "link"]),
  form: proposalFormSchema,
});

/**
 * POST /api/root/proposals/issue — «Скачать PDF» / «Скопировать ссылку на
 * веб-версию»: подписанные ссылки + строка в журнале аудита (организация
 * platform) и `[kp]` в логе — кто, какой сфере и с каким промокодом выдал КП.
 */
export async function POST(request: Request) {
  const session = await requireRoot();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  }
  const resolved = await resolveProposalForm(parsed.data.form, { sender: await readDefaultProposalSender() });
  const webUrl = `${proposalAppOrigin()}/kp/${signProposalToken(resolved.vars)}`;
  const pdfUrl = proposalPdfUrl(webUrl);
  const details = { ...proposalAuditDetails(resolved.vars), action: parsed.data.action, promoSource: resolved.promoSource };
  console.info(
    `[kp] root issue action=${parsed.data.action} sphere=${resolved.vars.sphere} promo=${resolved.vars.promo?.code ?? "-"} by=${session.user.email ?? session.user.id}`,
  );
  await recordAuditLog({
    request,
    session,
    organizationId: PLATFORM_ORG_ID,
    action: parsed.data.action === "pdf" ? "proposal.pdf" : "proposal.link",
    entity: PROPOSAL_AUDIT_ENTITY,
    entityId: resolved.vars.promo?.code ?? resolved.vars.sphere,
    details,
  });
  return NextResponse.json({ webUrl, pdfUrl, downloadUrl: `${pdfUrl}?download=1` });
}
