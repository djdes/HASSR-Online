import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditLog } from "@/lib/audit-log";
import { requireRoot } from "@/lib/auth-helpers";
import {
  PROPOSAL_SENDER_SETTING_KEY,
  readDefaultProposalSender,
  writeDefaultProposalSender,
} from "@/lib/proposal/context.server";
import { PLATFORM_ORG_ID, PROPOSAL_AUDIT_ENTITY } from "@/lib/proposal/root.server";
import { normalizeSender } from "@/lib/proposal/vars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1, "Укажите имя отправителя").max(120),
  phone: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().max(120).nullable().optional(),
  telegram: z.string().trim().max(120).nullable().optional(),
});

/** GET /api/root/proposals/sender — отправитель КП по умолчанию (`PlatformSetting` `proposal.sender`). */
export async function GET() {
  await requireRoot();
  return NextResponse.json({ sender: await readDefaultProposalSender() });
}

/** PUT — сохранить отправителя по умолчанию; изменение — в аудит и лог. */
export async function PUT(request: Request) {
  const session = await requireRoot();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  }
  const next = normalizeSender(parsed.data);
  if (!next) return NextResponse.json({ error: "Укажите имя отправителя" }, { status: 400 });
  if (parsed.data.email && !next.email) {
    return NextResponse.json({ error: "Почта отправителя указана с ошибкой" }, { status: 400 });
  }
  if (parsed.data.telegram && !next.telegram) {
    return NextResponse.json({ error: "Telegram: имя пользователя латиницей или ссылка t.me" }, { status: 400 });
  }
  const before = await readDefaultProposalSender();
  const saved = await writeDefaultProposalSender(next);
  console.info(`[kp] default sender updated by=${session.user.email ?? session.user.id}`);
  await recordAuditLog({
    request,
    session,
    organizationId: PLATFORM_ORG_ID,
    action: "proposal.sender.update",
    entity: PROPOSAL_AUDIT_ENTITY,
    entityId: PROPOSAL_SENDER_SETTING_KEY,
    details: { before, after: saved },
  });
  return NextResponse.json({ sender: saved });
}
