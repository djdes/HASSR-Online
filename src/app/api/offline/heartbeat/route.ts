import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { offlineDeviceLabel, parseOfflineHeartbeat } from "@/lib/offline/devices";
import { recordOfflineHeartbeat } from "@/lib/offline/devices.server";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/offline/heartbeat — a device that works without network reports
 * itself while online: how fresh its data is, how many records wait and how
 * many were not accepted. Session only; the device is filed under the
 * signed-in account and its active organization.
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нужно войти в кабинет" }, { status: 401 });
  const heartbeat = parseOfflineHeartbeat(await request.json().catch(() => null));
  if (!heartbeat) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  const result = await recordOfflineHeartbeat({
    organizationId: getActiveOrgId(session),
    userId: session.user.id,
    userName: session.user.name ?? "",
    label: offlineDeviceLabel(request.headers.get("user-agent")),
    heartbeat,
  });
  return NextResponse.json({ ok: true, ...result });
}
