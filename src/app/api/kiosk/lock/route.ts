import { NextResponse } from "next/server";
import { ALL_SESSION_COOKIES } from "@/lib/auth-cookies";

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
  for (const name of ALL_SESSION_COOKIES) {
    response.cookies.set(name, "", {
      path: "/",
      expires: new Date(0),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return response;
}
