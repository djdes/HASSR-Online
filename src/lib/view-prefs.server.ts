import { cookies } from "next/headers";

import { DEFAULT_VIEW_PREFS, VIEW_PREFS_COOKIE, parseViewPrefs, type ViewPrefs } from "@/lib/view-prefs";

/** Настройки «Удобства чтения» этого устройства — из куки запроса. */
export async function readViewPrefs(): Promise<ViewPrefs> {
  try {
    const store = await cookies();
    return parseViewPrefs(store.get(VIEW_PREFS_COOKIE)?.value);
  } catch {
    // Вне запроса (сборка статических страниц) куки нет — по умолчанию.
    return DEFAULT_VIEW_PREFS;
  }
}
