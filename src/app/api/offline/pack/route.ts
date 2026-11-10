import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { buildOfflinePack } from "@/lib/offline/pack.server";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/offline/pack — data the device keeps to work with no network
 * (people, journals, forms, objects, a month of row values). Session only;
 * the organization is the active one of the session.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нужно войти в кабинет" }, { status: 401 });
  try {
    const pack = await buildOfflinePack(session);
    if (!pack) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
    return NextResponse.json(pack, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[offline-pack] build failed", error);
    return NextResponse.json({ error: "Не удалось собрать данные для работы без связи" }, { status: 500 });
  }
}
