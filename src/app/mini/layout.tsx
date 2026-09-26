import type { Metadata, Viewport } from "next";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { headers } from "next/headers";
import { isMobileAppUserAgent } from "@/lib/mobile-app";
import { MiniSessionProvider } from "./_components/mini-session-provider";
import { MiniAppShell } from "./_components/mini-app-shell";
import { loadMiniShellData } from "./_components/mini-shell-data";
import "./mini-theme.css";
// app-theme.css scopes site dashboard styles to `.app-shell` — needed
// here because the Mini App embeds site components (e.g. document
// editor in /mini/documents/[id]). We mirror `.app-shell` onto
// `#mini-root` so those embedded components pick up the right theme.
import "@/app/app-theme.css";

/**
 * Mini App layout.
 *
 * Intentionally separate from the dashboard layout — no sidebar, no nav
 * chrome, no AuthSessionProvider (which requires a non-null session and
 * thus redirects unauthenticated users). Mini App routes accept anonymous
 * visits because the initData-based sign-in happens client-side inside
 * `/mini` itself.
 *
 * Оформление — как у QR-страниц заполнения: тёмно-синяя шапка, белые
 * карточки, индиго #5566f6, крупные кнопки. См. `mini-theme.css`.
 */

export const metadata: Metadata = {
  // title.absolute обходит root layout's template "%s — WeSetup". Без
  // absolute получали бы "WeSetup — Mini App — WeSetup" (бренд дублируется).
  title: { absolute: "WeSetup — Mini App" },
  robots: { index: false, follow: false },
  // Манифест живёт здесь, а не в корневом layout: на домашний экран
  // ставится рабочий кабинет, а не маркетинговый сайт.
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "WeSetup",
    // Шапка приложения тёмно-синяя в обеих темах — статус-бар в тон,
    // иначе на iOS сверху остаётся светлая полоса над шапкой.
    statusBarStyle: "black-translucent",
  },
};

const BASE_VIEWPORT: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Цвет фирменной шапки — тот же `theme-color`, что у QR-страниц.
  themeColor: "#0b1024",
};

/** В приложении WeSetup — во весь экран, отступы считает вёрстка (см. корневой layout). */
export async function generateViewport(): Promise<Viewport> {
  const inApp = isMobileAppUserAgent((await headers()).get("user-agent"));
  return inApp ? { ...BASE_VIEWPORT, viewportFit: "cover" } : BASE_VIEWPORT;
}

export default async function MiniLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Тему читаем на сервере, чтобы первый кадр был в правильном цвете.
  // До входа (он происходит на клиенте по initData) её ещё нет —
  // тогда идёт значение по умолчанию, а клиент подставит тему Telegram.
  const session = await getServerSession(authOptions).catch(() => null);
  const shell = await loadMiniShellData(session);

  return (
    <MiniSessionProvider initialSession={session}>
      <MiniAppShell {...shell}>{children}</MiniAppShell>
    </MiniSessionProvider>
  );
}
