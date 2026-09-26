"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";

import { adoptCookieSession } from "./_lib/cookie-session";
import { isSignedOutManually, miniEntryStep } from "./_lib/signed-out-mark";
import { sanitizeMiniAppRedirectPath } from "@/lib/journal-obligation-links";
import { miniHomeHref } from "@/app/mini/_lib/nav-items";
import { getTelegramWebApp } from "./_components/telegram-web-app";
import {
  telegramSignInProblemFromMessage,
  type TelegramSignInProblem,
} from "@/lib/telegram-auth-messages";

/**
 * Вход в мини-приложение — и больше ничего.
 *
 * Своей «главной» у приложения нет: оно показывает страницы кабинета в
 * мобильной оболочке (П-3), поэтому дом здесь тот же, что на сайте, —
 * `/dashboard` у руководства и `/journals` у остальных. Этот экран
 * делает ровно три вещи: входит по Telegram initData, подхватывает уже
 * живую куку и уводит человека туда, куда он шёл (`?next=`) или домой.
 *
 * Исключение — человек сам нажал «Выйти» (пометка из
 * `_lib/signed-out-mark.ts`): тогда в Telegram сами не входим, а открываем
 * экран входа. Иначе он тут же оказывался в том же аккаунте и не мог
 * войти в другой.
 */

type LocalState =
  | { kind: "init" }
  | {
      kind: "error";
      message: string;
      /** Отказ Telegram: повтор не поможет, нужно переоткрыть из бота. */
      problem?: TelegramSignInProblem | null;
    };

export default function MiniEntryPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [localState, setLocalState] = useState<LocalState>({ kind: "init" });
  const signInStarted = useRef(false);
  const redirectStarted = useRef(false);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // `next` пускаем и на адреса сайта: ссылка из бота ведёт прямо в
  // журнал кабинета, и после входа человек обязан оказаться там.
  const nextPath = (() => {
    // Пустой `next` разбирается как «/» — публичная главная сайта: без
    // этой проверки после входа человек оказывался на лендинге, а не в
    // кабинете.
    const raw = searchParams.get("next");
    if (!raw) return null;
    const target = sanitizeMiniAppRedirectPath(raw);
    return target === "/mini" || target === "/" ? null : target;
  })();

  useEffect(() => {
    if (status !== "unauthenticated" || signInStarted.current) return;

    const webApp = getTelegramWebApp();
    const back = window.location.pathname + window.location.search;
    const loginUrl = `/mini/login?next=${encodeURIComponent(back)}`;
    const step = miniEntryStep({
      hasInitData: Boolean(webApp?.initData),
      signedOut: isSignedOutManually(),
    });
    if (step === "cookie-or-login" || !webApp) {
      // Вне Telegram ведём на вход по телефону и паролю: кабинет должен
      // открываться и обычной вкладкой браузера. Кука уже может быть
      // (вход по телефону, установленное приложение), но провайдер сам
      // её не перечитает — см. `_lib/cookie-session.ts`. Страховка на
      // 4 с: лучше форма входа, чем вечное «Открываем кабинет…».
      signInStarted.current = true;
      void (async () => {
        const adopted = await adoptCookieSession();
        if (!adopted) {
          router.replace(loginUrl);
          return;
        }
        window.setTimeout(() => {
          if (statusRef.current !== "authenticated") router.replace(loginUrl);
        }, 4000);
      })();
      return;
    }
    if (step === "login-screen") {
      // Человек сам нажал «Выйти»: входить за него по Telegram нельзя —
      // Telegram привязан к одному аккаунту, и в другой он бы уже не
      // попал. Экран входа: «Войти через Telegram» или телефон/почта и
      // пароль. Пометку снимает любой успешный вход.
      signInStarted.current = true;
      router.replace(loginUrl);
      return;
    }
    try {
      webApp.ready();
      webApp.expand();
    } catch {
      /* older TG clients don't expose every method */
    }
    signInStarted.current = true;
    void (async () => {
      // Race с таймаутом 12 с — на тонком cellular из подвала кухни
      // signIn может зависнуть навсегда, и человеку нужен явный экран
      // ошибки с кнопкой, а не бесконечная крутилка.
      const timeoutPromise = new Promise<{ timeout: true }>((resolve) =>
        setTimeout(() => resolve({ timeout: true }), 12000)
      );
      const signInPromise = signIn("telegram", {
        initData: webApp.initData,
        redirect: false,
      });
      const result = await Promise.race([
        signInPromise.then((r) => ({ timeout: false as const, r })),
        timeoutPromise,
      ]);
      if ("timeout" in result && result.timeout) {
        setLocalState({
          kind: "error",
          message: "Telegram отвечает медленно. Проверьте подключение.",
        });
        return;
      }
      const r = "r" in result ? result.r : null;
      if (!r || r.error) {
        const message = r?.error || "Сессия Telegram не получена";
        setLocalState({
          kind: "error",
          message,
          problem: telegramSignInProblemFromMessage(message),
        });
      }
    })();
  }, [router, status]);

  // Вошли — уводим. Дальше человек работает на страницах сайта внутри
  // оболочки приложения, и возвращаться на этот экран ему незачем,
  // поэтому `replace`, а не `push`.
  useEffect(() => {
    if (status !== "authenticated" || redirectStarted.current) return;
    redirectStarted.current = true;
    // Тот же адрес, что у первой вкладки меню: у линейного сотрудника
    // это «Сегодня», у заведующей — контрольная доска. Раньше всех
    // вели на `/journals`, откуда сразу перекидывало дальше — лишний
    // прыжок и мигающий экран.
    router.replace(nextPath ?? miniHomeHref(session?.user ?? null));
  }, [nextPath, router, session?.user, status]);

  if (localState.kind === "error") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <section className="mini-card w-full px-6 py-8 text-center">
          <span
            className="mini-tile mx-auto"
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "var(--mini-danger-soft)",
              color: "var(--mini-danger)",
            }}
          >
            <ShieldAlert className="size-7" />
          </span>
          <h1 className="mini-h1 mt-4" style={{ fontSize: 22 }}>
            Не получилось войти
          </h1>
          <p
            className="mt-2 text-[16px] leading-relaxed"
            style={{ color: "var(--mini-danger)" }}
          >
            {localState.message}
          </p>
          {/* Когда Telegram отказал в подписи (устарела или не сошлась),
              повтор не поможет никогда: те же данные отправятся снова.
              Единственный выход — закрыть приложение и открыть его из
              бота, чтобы Telegram выдал свежую подпись. */}
          {localState.problem ? (
            <button
              type="button"
              onClick={() => {
                try {
                  getTelegramWebApp()?.close?.();
                } catch {
                  /* старый клиент — кнопка просто ничего не сделает */
                }
              }}
              className="mini-btn-primary mini-press mt-5 w-full"
            >
              Закрыть приложение
            </button>
          ) : (
            /* Повтор: `signInStarted` уже true, и без сброса флага новый
               вход не запустится никогда. */
            <button
              type="button"
              onClick={() => {
                signInStarted.current = false;
                setLocalState({ kind: "init" });
              }}
              className="mini-btn-primary mini-press mt-5 w-full"
            >
              Попробовать ещё раз
            </button>
          )}
          {/* Второй выход из этого экрана. «Аккаунт не связан с
              Telegram» — тоже тупик: повторять вход бессмысленно, пока
              руководитель не привяжет аккаунт. Телефон и пароль
              работают независимо от привязки. */}
          <div className="mt-2">
            <Link href="/mini/login" className="mini-btn-secondary mini-press w-full">
              Войти по телефону
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <Loader2
        className="size-7 animate-spin"
        style={{ color: "var(--mini-accent)" }}
      />
      <div className="text-[18px] font-semibold" style={{ color: "var(--mini-text)" }}>
        Открываем кабинет…
      </div>
      <p className="text-[16px]" style={{ color: "var(--mini-text-muted)" }}>
        Проверяем вход — это займёт пару секунд.
      </p>
    </div>
  );
}
