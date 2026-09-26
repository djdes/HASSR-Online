"use client";

import type { Session } from "next-auth";
import { SessionProvider, useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { adoptCookieSession } from "../_lib/cookie-session";
import { clearSignedOutMark, isSignedOutManually } from "../_lib/signed-out-mark";
import { getTelegramWebApp } from "./telegram-web-app";

/**
 * SessionProvider for the Mini App route group.
 *
 * Unlike `AuthSessionProvider` (which demands a non-null session), this one
 * starts with `session={null}` and lets the Mini App's `/page.tsx` trigger
 * a Telegram `signIn` once the client has `window.Telegram.WebApp.initData`
 * in hand. `refetchOnWindowFocus` stays off because the Mini App webview
 * triggers focus events aggressively on iOS.
 *
 * Вне Telegram у провайдера нет способа узнать о живой куке (см.
 * `_lib/cookie-session.ts`), и любая страница Mini на холодном старте
 * висела бы на «Загружаем…». `CookieSessionBootstrap` подхватывает куку
 * для всех страниц разом; главная сверх этого решает, вести ли на вход.
 */
function CookieSessionBootstrap() {
  const { status } = useSession();
  const pathname = usePathname();
  const started = useRef(false);

  // Любой успешный вход снимает пометку «вышел вручную»
  // (`_lib/signed-out-mark.ts`): Telegram, телефон, почта, вход на сайте в
  // этом же браузере. Сессия есть — в следующий раз снова входим сами.
  useEffect(() => {
    if (status === "authenticated") clearSignedOutMark();
  }, [status]);

  useEffect(() => {
    if (status !== "unauthenticated" || started.current) return;
    const insideTelegram = Boolean(getTelegramWebApp()?.initData);
    if (insideTelegram) {
      // В Telegram вход делает главная через signIn("telegram") — не мешаем.
      if (pathname === "/mini") return;
      // Экран входа сам и есть вход. Раньше и с него уводило на главную, та
      // входила по Telegram — и войти в другой аккаунт (или по телефону,
      // когда Telegram не привязан) было нельзя.
      if (pathname === "/mini/login") return;
      // Человек сам нажал «Выйти» — никуда не уводим: главная всё равно
      // открыла бы экран входа, а в момент выхода этот переход спорил бы
      // с переходом профиля на экран входа.
      if (isSignedOutManually()) return;
    }
    started.current = true;
    void adoptCookieSession().then((adopted) => {
      // Любой другой экран в Telegram (обновление страницы, прямая
      // ссылка, переход из раздела сайта) раньше не спрашивал куку вовсе
      // и навсегда оставался на «Загружаем…». Куки нет — входить умеет
      // только главная, ведём туда с возвратом на этот экран.
      if (adopted || !insideTelegram) return;
      window.location.replace(`/mini?next=${encodeURIComponent(pathname)}`);
    });
  }, [status, pathname]);
  return null;
}

export function MiniSessionProvider({
  children,
  initialSession = null,
}: {
  children: React.ReactNode;
  /**
   * Сессия, которую сервер уже прочитал из куки. С ней экран сразу
   * «authenticated» — без лишнего запроса и без кадра «Загружаем…».
   */
  initialSession?: Session | null;
}) {
  return (
    <SessionProvider
      session={initialSession}
      refetchOnWindowFocus={false}
      refetchWhenOffline={false}
      refetchInterval={0}
    >
      <CookieSessionBootstrap />
      {children}
    </SessionProvider>
  );
}
