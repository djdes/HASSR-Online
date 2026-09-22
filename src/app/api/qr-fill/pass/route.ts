import { NextResponse } from "next/server";

import { clientIp } from "@/lib/client-ip";
import { resolveQrFillActor } from "@/lib/qr-fill-actor";
import { QR_FILL_RATE_LIMIT_ERROR, qrFillRateKey } from "@/lib/qr-fill-audit";
import { resolveQrObject, type QrObjectKind } from "@/lib/qr-object-pass";
import { mintQrPass } from "@/lib/qr-pin-pass";
import { rememberClearCookie, rememberSetCookie } from "@/lib/qr-remember";
import { qrFillRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/qr-fill/pass — шаг PIN на наклейке холодильника / помещения /
 * УФ-лампы (2026-09-22). Тело: { kind, objectId, token, employeeId, pin?, remember? }.
 *
 * • pin передан → проверка (5 ошибок — блокировка) и пропуск визита { pass };
 * • remember — «Запомнить выбор на этом оборудовании»: подписанная cookie
 *   организации (та же, что у QR-журналов), снимается при remember=false.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { kind?: unknown; objectId?: unknown; token?: unknown; employeeId?: unknown; pin?: unknown; remember?: unknown }
    | null;
  const kind: QrObjectKind | null = body?.kind === "equipment" || body?.kind === "room" ? body.kind : null;
  const objectId = typeof body?.objectId === "string" ? body.objectId : "";
  const token = typeof body?.token === "string" ? body.token : "";
  const employeeId = typeof body?.employeeId === "string" ? body.employeeId : "";
  if (!kind || !objectId || !token || !employeeId) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  if (!qrFillRateLimiter.consume(qrFillRateKey(clientIp(request), kind, objectId))) {
    return NextResponse.json({ error: QR_FILL_RATE_LIMIT_ERROR }, { status: 429 });
  }
  const object = await resolveQrObject(kind, objectId, token);
  if (!object) return NextResponse.json({ error: "QR-наклейка не подходит" }, { status: 401 });

  let pass: string | null = null;
  if (typeof body?.pin === "string" && body.pin.trim()) {
    const actor = await resolveQrFillActor({ mode: "pin", organizationId: object.organizationId, employeeId, pin: body.pin.trim() });
    if (!actor.ok) return NextResponse.json({ error: actor.error }, { status: actor.status });
    pass = mintQrPass({ employeeId, orgId: object.organizationId, flow: "any" });
  }

  const response = NextResponse.json({ ok: true, pass });
  if (object.mode !== "auth" && typeof body?.remember === "boolean") {
    const secure = (request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "")) === "https";
    response.headers.append(
      "Set-Cookie",
      body.remember ? rememberSetCookie(object.organizationId, employeeId, { secure }) : rememberClearCookie(object.organizationId, { secure })
    );
  }
  return response;
}
