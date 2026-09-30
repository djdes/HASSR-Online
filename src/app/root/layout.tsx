import Link from "next/link";
import { Settings2 } from "lucide-react";
import { requireRoot } from "@/lib/auth-helpers";
import { RootNav } from "@/components/root/root-nav";
import { db } from "@/lib/db";
import { AuthSessionProvider } from "@/components/layout/session-provider";
import {
  SiteThemeBootstrap,
  SiteThemeProvider,
} from "@/components/theme/site-theme";
import { Toaster } from "@/components/ui/sonner";
import { readInitialTheme } from "@/lib/site-theme.server";
import "@/app/app-theme.css";

export const dynamic = "force-dynamic";

// /root/* — platform-superadmin area. Must never be indexed.
// robots.txt уже блокирует /root/ через Disallow, но HTML-meta — defense
// in depth (защита если кто-то получит deep-link и поделится в шарящем
// link-preview сервисе типа Telegram-бота или WhatsApp).
export const metadata = {
  robots: { index: false, follow: false },
};

export default async function RootAreaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // All /root/* pages are gated here + in middleware. Middleware returns 404
  // without a valid root JWT, requireRoot() throws notFound() again as a
  // belt-and-braces safety net in case middleware is ever bypassed.
  const session = await requireRoot();

  const profile = await db.user.findUnique({
    where: { id: session.user.id },
    select: { themePreference: true },
  });
  const initialTheme = await readInitialTheme(profile?.themePreference);

  return (
    // AuthSessionProvider обязателен — клиентские компоненты типа
    // ImpersonateButton используют useSession()/update() для смены
    // actingAsOrganizationId. Без провайдера destructure undefined
    // → React error boundary → «Что-то пошло не так» на любой
    // /root/* странице где есть подобные кнопки.
    <AuthSessionProvider session={session}>
    <SiteThemeProvider initialTheme={initialTheme}>
      <div
        className="app-shell min-h-screen bg-[#f4f5fb]"
        data-app-theme={initialTheme}
        suppressHydrationWarning
      >
      {/* Первым ребёнком — красит оболочку до первого кадра. */}
      <SiteThemeBootstrap />
      {/* Шапка в две строки: кто вошёл — сверху, разделы — под ней.
          Девятнадцать разделов одной строкой не помещались. */}
      <header className="border-b border-[#ececf4] bg-[#0b1024] text-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:gap-4 sm:px-8 sm:pt-5">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/60 sm:text-[12px]">
              WeSetup · Platform
            </div>
            <div className="mt-1 truncate text-[16px] font-semibold tracking-tight sm:text-[20px]">
              {session.user.name || session.user.email}
            </div>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-white/10 px-3 py-1.5 text-[14px] transition-colors duration-150 hover:bg-white/20"
          >
            <Settings2 className="size-4" />
            Выйти в приложение
          </Link>
        </div>
        <div className="mx-auto max-w-[1400px] px-4 pb-3 pt-3 sm:px-8">
          <RootNav />
        </div>
      </header>

        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
      {/* Тосты ответов из админки (чаты, обращения): без тостера они
          молча пропадали, и было непонятно, ушёл ли ответ. */}
      <Toaster />
    </SiteThemeProvider>
    </AuthSessionProvider>
  );
}
