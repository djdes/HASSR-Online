import { NextResponse } from "next/server";
import { z } from "zod";

import { requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { normalizeQrFillMode, setEmployeeQrPin } from "@/lib/qr-fill-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ pin: z.string().max(12).nullable() });

/**
 * Свой PIN для QR-форм (режим «имя + PIN» в организации). Сотрудник
 * задаёт его сам в профиле Mini App; руководитель может задать в карточке.
 *
 *   GET  → { hasPin, mode }
 *   POST { pin } | { pin: null } → задать / снять
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const user = await db.user.findUnique({
    where: { id: auth.session.user.id },
    select: { qrPinHash: true, organization: { select: { qrFillMode: true } } },
  });
  return NextResponse.json({ hasPin: Boolean(user?.qrPinHash), mode: normalizeQrFillMode(user?.organization?.qrFillMode) });
}

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }
  const error = await setEmployeeQrPin(auth.session.user.id, body.pin);
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ ok: true, hasPin: body.pin !== null });
}
