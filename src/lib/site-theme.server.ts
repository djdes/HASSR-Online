import { cookies } from "next/headers";

import { THEME_COOKIE, pickInitialTheme, type ThemeValue } from "@/lib/theme-cookie";

/**
 * Тема первого кадра для оболочек сайта (`/root`, `/partner`, `/master`):
 * тема этого устройства из куки, иначе тема профиля. Подробно — в
 * `lib/theme-cookie.ts`.
 */
export async function readInitialTheme(
  profileTheme: string | null | undefined,
): Promise<ThemeValue> {
  const store = await cookies();
  return pickInitialTheme(store.get(THEME_COOKIE)?.value, profileTheme);
}
