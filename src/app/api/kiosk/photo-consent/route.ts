import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/kiosk/photo-consent — сотрудник соглашается на фотофиксацию
 * входа на общем планшете. Даётся один раз самим сотрудником (уже после
 * верного ПИН — личность подтверждена), хранится в User.kioskPhotoConsentAt.
 * Body: { agree: boolean } — false снимает согласие.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.kioskDeviceId) {
    return NextResponse.json({ error: "Нужна сессия общего планшета" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { agree?: boolean };
  const agree = body.agree !== false;
  await db.user.update({
    where: { id: session.user.id },
    data: { kioskPhotoConsentAt: agree ? new Date() : null },
  });
  return NextResponse.json({ ok: true, consent: agree });
}
