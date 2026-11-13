import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { clientEmailContentSchema } from "@/lib/client-email";
import { clientEmailPreview } from "@/lib/client-email.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await params;
  if (!await db.organization.findUnique({ where: { id }, select: { id: true } })) {
    return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  }
  const parsed = clientEmailContentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  const preview = await clientEmailPreview(session.user.id, parsed.data);
  if (!preview) return NextResponse.json({ error: "Подключите и проверьте личную почту в разделе «Моя почта»" }, { status: 409 });
  return NextResponse.json({ html: preview.html });
}
