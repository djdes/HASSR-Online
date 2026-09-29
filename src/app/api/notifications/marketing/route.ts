import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { getMarketingSubscription, setMarketingSubscription } from "@/lib/mailing/public.server";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Новости и предложения» — переключатель в профиле (настройки уведомлений
 * и профиль приложения): реклама во всех каналах рассылки — почта,
 * колокольчик, push, Telegram. Служебные письма и уведомления не затрагивает.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  return NextResponse.json(await getMarketingSubscription(session.user.id));
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { subscribed?: unknown } | null;
  if (typeof body?.subscribed !== "boolean") {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }
  try {
    return NextResponse.json(await setMarketingSubscription(session.user.id, body.subscribed, request));
  } catch (error) {
    console.error("[mailing] profile marketing toggle failed", error);
    return NextResponse.json({ error: "Не удалось сохранить" }, { status: 500 });
  }
}
