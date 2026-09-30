import { NextResponse, type NextRequest } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Persist the user's chosen theme. Single source of truth across surfaces:
 *
 *   - `/dashboard` SiteThemeSwitcher → POST /api/me/theme
 *   - Mini App `/mini/me` toggle → POST /api/me/theme
 *
 * Both surfaces also mirror the value to `localStorage("wesetup-app-theme")`
 * for instant FOUC-free reloads on the same device. The server side reads
 * `User.themePreference` once per layout render, so a user who flipped the
 * theme on their phone in Telegram sees the same theme when they open
 * `wesetup.ru` on a desktop.
 */
/**
 * Текущая сохранённая тема.
 *
 * Нужна Mini App: вход из Telegram происходит на клиенте, серверная
 * разметка к этому моменту уже отдана с темой по умолчанию. Без этого
 * запроса выбранная светлая тема появлялась бы только после
 * перезагрузки страницы.
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;

  const user = await db.user.findUnique({
    where: { id: auth.session.user.id },
    select: { themePreference: true },
  });

  return NextResponse.json({
    theme: user?.themePreference === "light" ? "light" : "dark",
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const theme =
    typeof body === "object" && body && "theme" in body
      ? (body as { theme: unknown }).theme
      : null;

  if (theme !== "light" && theme !== "dark") {
    return NextResponse.json(
      { error: "theme must be 'light' or 'dark'" },
      { status: 400 }
    );
  }

  await db.user.update({
    where: { id: auth.session.user.id },
    data: { themePreference: theme },
  });
  // Смена темы в профиле — по ней рисуются новые устройства; «прыгает
  // тема» разбирается по этой строке и куке `wesetup-theme` устройства.
  console.info(`[theme] профиль user=${auth.session.user.id} → ${theme}`);

  return NextResponse.json({ ok: true, theme });
}
