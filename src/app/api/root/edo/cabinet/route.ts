import { NextResponse } from "next/server";
import { z } from "zod";

import { requireRoot } from "@/lib/auth-helpers";
import { edoErrorResponse } from "@/lib/edo/api-response.server";
import { disconnectEdoCabinet, edoBaseUrlOptions, getEdoCabinetView, saveEdoCabinet } from "@/lib/edo/cabinet.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Кабинет Saby ООО «БФС» для ЭДО.
 * GET — кабинет (без защищённого ключа и сессии) и допустимые адреса; PUT — подключить по ключам
 * приложения и сразу проверить; DELETE — отключить (выход из сессии, ключи удаляются).
 */
const saveSchema = z.object({
  clientId: z.string().trim().min(1, "Укажите ID подключения Saby").max(200),
  appSecret: z.string().trim().min(1, "Укажите защищённый ключ Saby").max(500),
  baseUrl: z.string().trim().max(200).optional(),
});

export async function GET() {
  await requireRoot();
  try {
    return NextResponse.json({ cabinet: await getEdoCabinetView(), baseUrls: edoBaseUrlOptions() });
  } catch (e) {
    return edoErrorResponse(e, "cabinet GET");
  }
}

export async function PUT(request: Request) {
  const session = await requireRoot();
  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 });
  }
  try {
    return NextResponse.json({ cabinet: await saveEdoCabinet(parsed.data, session.user.id ?? null) });
  } catch (e) {
    return edoErrorResponse(e, "cabinet PUT");
  }
}

export async function DELETE() {
  await requireRoot();
  try {
    await disconnectEdoCabinet();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return edoErrorResponse(e, "cabinet DELETE");
  }
}
