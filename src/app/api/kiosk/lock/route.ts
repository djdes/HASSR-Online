import { NextResponse } from "next/server";
import { expireSessionCookies } from "@/lib/auth-cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/kiosk/lock — явный выход сотрудника с общего планшета.
 *
 * Гасим только сессионные куки; device-cookie `wesetup.kiosk` остаётся —
 * планшет по-прежнему киоск и сразу показывает список сотрудников.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  // Все имена сессии, с атрибутами как при установке (`__Secure-` — с Secure).
  expireSessionCookies(response.cookies);
  return response;
}
