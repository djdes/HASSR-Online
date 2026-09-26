import { NextResponse } from "next/server";
import { expireSignOutCookies } from "@/lib/auth-cookies";

/**
 * POST /api/auth/logout — выход на этом устройстве. Гасит все имена куки
 * сессии (актуальное и легаси — с теми же атрибутами, что при установке),
 * служебные куки старого next-auth и режим оболочки мини-приложения.
 *
 * Зовут его все кнопки «Выйти» через общий помощник (`lib/sign-out.ts`).
 * Куки пишутся только через `response.cookies`: строка, добавленная до
 * этого через `headers.append`, пропадала бы при первом `cookies.set`
 * (так раньше терялась очистка режима оболочки).
 */
export async function POST() {
  const response = NextResponse.json({ success: true });
  expireSignOutCookies(response.cookies);
  return response;
}
