import { NextResponse } from "next/server";
import {
  ALL_SESSION_COOKIES,
  LEGACY_AUX_COOKIES,
} from "@/lib/auth-cookies";
import { buildMiniShellClearCookie } from "@/lib/mini-shell-cookie";

export async function POST() {
  const response = NextResponse.json({ success: true });

  // Режим оболочки мини-приложения сбрасываем вместе с сессией: на
  // общем компьютере следующий вошедший должен увидеть обычный сайт,
  // а не мобильную оболочку предыдущего.
  response.headers.append(
    "Set-Cookie",
    buildMiniShellClearCookie(process.env.NODE_ENV === "production")
  );

  for (const cookieName of [...ALL_SESSION_COOKIES, ...LEGACY_AUX_COOKIES]) {
    response.cookies.set(cookieName, "", {
      path: "/",
      expires: new Date(0),
      httpOnly: cookieName.includes("session-token"),
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }

  return response;
}
