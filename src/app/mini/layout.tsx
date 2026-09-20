import type { Metadata, Viewport } from "next";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
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
 * Theme: "Dark Kitchen Operator" — editorial dark mode с fraunces-italic
 * заголовками, lime-accent, зерном на фоне. См. `mini-theme.css`.
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
    // Тёмная тема кабинета — статус-бар в тон, иначе на iOS сверху
    // остаётся светлая полоса поверх почти чёрного экрана.
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0a0b0f",
};

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
      <MiniAppShell {...shell} ownRoutes>
        {children}
      </MiniAppShell>
    </MiniSessionProvider>
  );
}
