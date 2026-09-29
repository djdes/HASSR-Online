import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { readDefaultProposalSender } from "@/lib/proposal/context.server";
import { buildProposalPreview, proposalFormSchema, resolveProposalForm } from "@/lib/proposal/root.server";
import { proposalAppOrigin } from "@/lib/proposal/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/root/proposals — предпросмотр КП для генератора: ссылки на
 * веб-версию и PDF, письмо (HTML и текст), предупреждения. Ничего не
 * сохраняет и в аудит не пишет — это черновик на каждое изменение формы;
 * «Скачать PDF» и «Скопировать ссылку» идут через `/issue` (с аудитом).
 */
export async function POST(request: Request) {
  const session = await requireRoot();
  const parsed = proposalFormSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  }
  const resolved = await resolveProposalForm(parsed.data, { sender: await readDefaultProposalSender() });
  const preview = await buildProposalPreview(resolved, proposalAppOrigin());
  console.info(
    `[kp] root preview sphere=${resolved.vars.sphere} promo=${resolved.vars.promo?.code ?? "-"} source=${resolved.promoSource} warnings=${preview.warnings.length} by=${session.user.email ?? session.user.id}`,
  );
  return NextResponse.json({
    webUrl: preview.webUrl,
    pdfUrl: preview.pdfUrl,
    email: preview.email,
    content: preview.content,
    warnings: preview.warnings,
    promoSource: resolved.promoSource,
  });
}
