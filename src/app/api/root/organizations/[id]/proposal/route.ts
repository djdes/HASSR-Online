import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { clientProposalSchema } from "@/lib/client-documents";
import { renderClientProposal } from "@/lib/client-documents.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/root/organizations/[id]/proposal — PDF КП для этого клиента
 * (подписан сотрудником, который его готовит). Ничего не отправляет.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  const parsed = clientProposalSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  const rendered = await renderClientProposal(id, parsed.data, session.user.id);
  if (!rendered) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  return new Response(new Uint8Array(rendered.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="WeSetup-KP.pdf"; filename*=UTF-8''${encodeURIComponent(rendered.fileName)}`,
      "Cache-Control": "no-store",
      ...(rendered.warnings.length ? { "X-Proposal-Warnings": encodeURIComponent(rendered.warnings.join(" | ")) } : {}),
    },
  });
}
