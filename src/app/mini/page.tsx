"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, Phone, ShieldAlert } from "lucide-react";

import { adoptCookieSession } from "./_lib/cookie-session";
import { clearSignedOutMark, isSignedOutManually, miniEntryStep } from "./_lib/signed-out-mark";
import { sanitizeMiniAppRedirectPath } from "@/lib/journal-obligation-links";
import { NPS_PREVIEW_PARAM, isNpsPreviewRequested, withNpsPreview } from "@/lib/nps";
import { DENIED_PARAM, withDeniedParam } from "@/lib/denied-notice";
import { miniHomeHref } from "@/app/mini/_lib/nav-items";
import { getTelegramWebApp, requestTelegramContact } from "./_components/telegram-web-app";
import { miniEntryErrorPresentation, type MiniEntryErrorKey } from "@/lib/mini-entry-error-presentation";

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
      errorKey: MiniEntryErrorKey;
      /** Отказ Telegram: повтор не поможет, нужно переоткрыть из бота. */
      problem?: "expired" | "not-confirmed" | null;
    };

type LinkPhoneState =
  | "idle"
  | "sharing"
  | "pendingBot"
  | "success"
  | "declined"
  | "notFound"
  | "ambiguous"
  | "alreadyLinkedOther"
  | "userHasOtherTelegram"
  | "failed";

function mapLinkPhoneErrorStatus(status: unknown): LinkPhoneState {
  switch (status) {
    case "not_found":
      return "notFound";
    case "ambiguous":
      return "ambiguous";
    case "telegram_already_linked_other":
      return "alreadyLinkedOther";
    case "user_already_linked_other_tg":
      return "userHasOtherTelegram";
    default:
      return "failed";
  }
}

export default function MiniEntryPage() {
  const t = useTranslations("miniHome.entry");
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [localState, setLocalState] = useState<LocalState>({ kind: "init" });
  const [authAttempt, setAuthAttempt] = useState(0);
  const [linkPhoneState, setLinkPhoneState] = useState<LinkPhoneState>("idle");
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
  // `/mini?nps=1` — показать опрос «Посоветуете WeSetup коллегам?» сразу:
  // своей главной у приложения нет, поэтому метку несём туда, куда уводим.
  const npsPreview = isNpsPreviewRequested(searchParams.get(NPS_PREVIEW_PARAM));
  // `/mini?denied=<раздел>` — proxy увёл из закрытого раздела: метку несём
  // на домашнюю, она один раз объяснит, почему (2026-10-29).
  const deniedFrom = searchParams.get(DENIED_PARAM);

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
          errorKey: "timeout",
        });
        return;
      }
      const r = "r" in result ? result.r : null;
      if (!r || r.error) {
        const message = r?.error ?? null;
        const error = miniEntryErrorPresentation(message);
        setLocalState({
          kind: "error",
          errorKey: error.key,
          problem: error.problem,
        });
      }
    })();
  }, [authAttempt, router, status]);

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
    const target = nextPath ?? miniHomeHref(session?.user ?? null);
    const withNps = npsPreview ? withNpsPreview(target) : target;
    router.replace(deniedFrom ? withDeniedParam(withNps, deniedFrom) : withNps);
  }, [deniedFrom, nextPath, npsPreview, router, session?.user, status]);

  function resolveErrorText(errorKey: MiniEntryErrorKey): string {
    switch (errorKey) {
      case "timeout":
        return t("error.timeout");
      case "sessionUnavailable":
        return t("error.sessionUnavailable");
      case "expired":
        return t("error.expired");
      case "notConfirmed":
        return t("error.notConfirmed");
      case "notConfigured":
        return t("error.notConfigured");
      case "notLinked":
        return t("error.notLinked");
      case "generic":
        return t("error.generic");
    }
  }

  function resolveLinkPhoneErrorText(state: LinkPhoneState): string | null {
    switch (state) {
      case "declined":
        return t("linkPhone.declined");
      case "notFound":
        return t("linkPhone.notFound");
      case "ambiguous":
        return t("linkPhone.ambiguous");
      case "alreadyLinkedOther":
        return t("linkPhone.alreadyLinkedOther");
      case "userHasOtherTelegram":
        return t("linkPhone.userHasOtherTelegram");
      case "failed":
        return t("linkPhone.failed");
      default:
        return null;
    }
  }

  async function handleSharePhone() {
    if (
      linkPhoneState === "sharing" ||
      linkPhoneState === "pendingBot" ||
      linkPhoneState === "success"
    ) {
      return;
    }
    const webApp = getTelegramWebApp();
    if (!webApp?.initData) {
      setLinkPhoneState("failed");
      return;
    }
    setLinkPhoneState("sharing");
    const contact = await requestTelegramContact();
    if (contact.status === "cancelled") {
      setLinkPhoneState("declined");
      return;
    }
    if (contact.status === "unsupported") {
      setLinkPhoneState("failed");
      return;
    }

    const postLink = async (contactResponse?: string) => {
      const res = await fetch("/api/mini/link-telegram-phone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          contactResponse
            ? { initData: webApp.initData, contactResponse }
            : { initData: webApp.initData },
        ),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: string;
        homeHref?: string;
      };
      return { res, body };
    };

    const navigateAfterLink = (homeHref?: string) => {
      clearSignedOutMark();
      setLinkPhoneState("success");
      const target =
        nextPath ??
        (typeof homeHref === "string" && homeHref.startsWith("/") ? homeHref : "/mini");
      const withNps = npsPreview ? withNpsPreview(target) : target;
      window.location.assign(deniedFrom ? withDeniedParam(withNps, deniedFrom) : withNps);
    };

    try {
      const first = await postLink(contact.response);
      if (first.res.ok && first.body.ok) {
        navigateAfterLink(first.body.homeHref);
        return;
      }
      if (first.res.status === 202 || first.body.status === "pending_bot_contact") {
        setLinkPhoneState("pendingBot");
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 1500));
          const poll = await postLink();
          if (poll.res.ok && poll.body.ok) {
            navigateAfterLink(poll.body.homeHref);
            return;
          }
          if (poll.res.status !== 202 && poll.body.status !== "pending_bot_contact") {
            setLinkPhoneState(mapLinkPhoneErrorStatus(poll.body.status));
            return;
          }
        }
        setLinkPhoneState("failed");
        return;
      }
      setLinkPhoneState(mapLinkPhoneErrorStatus(first.body.status));
    } catch {
      setLinkPhoneState("failed");
    }
  }

  if (localState.kind === "error" && localState.errorKey === "notLinked") {
    const busyLinking = linkPhoneState === "sharing" || linkPhoneState === "pendingBot";
    const linkErrorText = resolveLinkPhoneErrorText(linkPhoneState);
    const passwordHref = nextPath
      ? `/mini/login?linkTg=1&next=${encodeURIComponent(nextPath)}`
      : "/mini/login?linkTg=1";

    return (
      <div className="flex flex-1 items-center justify-center">
        <section className="mini-card w-full px-6 py-8 text-center">
          <span
            className="mini-tile mx-auto"
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background:
                linkPhoneState === "success"
                  ? "var(--mini-ok-soft)"
                  : "var(--mini-accent-soft)",
              color:
                linkPhoneState === "success"
                  ? "var(--mini-ok)"
                  : "var(--mini-accent-ink)",
            }}
          >
            {linkPhoneState === "success" ? (
              <CheckCircle2 className="size-7" aria-hidden />
            ) : (
              <Phone className="size-7" aria-hidden />
            )}
          </span>
          <h1 className="mini-h1 mt-4" style={{ fontSize: 22 }}>
            {t("linkPhone.heading")}
          </h1>
          <p
            className="mt-2 text-[16px] leading-relaxed"
            style={{ color: "var(--mini-text-muted)" }}
          >
            {t("linkPhone.description")}
          </p>
          <button
            type="button"
            onClick={handleSharePhone}
            disabled={busyLinking || linkPhoneState === "success"}
            aria-busy={busyLinking}
            className="mini-btn-primary mini-press mt-5 w-full"
          >
            {busyLinking ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : (
              <Phone className="size-5" aria-hidden />
            )}
            {busyLinking ? t("linkPhone.sharing") : t("linkPhone.shareButton")}
          </button>
          {linkPhoneState === "success" ? (
            <p role="status" className="mini-ok-note mt-3">
              {t("linkPhone.success")}
            </p>
          ) : null}
          {linkPhoneState === "pendingBot" ? (
            <p role="status" className="mini-note mt-3">
              {t("linkPhone.pendingBot")}
            </p>
          ) : null}
          {linkErrorText ? (
            <p role="alert" className="mini-err mt-3">
              {linkErrorText}
            </p>
          ) : null}
          <p
            className="mt-4 text-[14px]"
            style={{ color: "var(--mini-text-muted)" }}
          >
            {t("linkPhone.orPassword")}
          </p>
          <Link
            href={passwordHref}
            className="mini-btn-secondary mini-press mt-2 w-full"
          >
            {t("linkPhone.passwordButton")}
          </Link>
        </section>
      </div>
    );
  }

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
            {t("error.heading")}
          </h1>
          <p
            className="mt-2 text-[16px] leading-relaxed"
            style={{ color: "var(--mini-danger)" }}
          >
            {resolveErrorText(localState.errorKey)}
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
              {t("action.closeApp")}
            </button>
          ) : (
            /* Повтор: `signInStarted` уже true, и без сброса флага новый
               вход не запустится никогда. */
            <button
              type="button"
              onClick={() => {
                signInStarted.current = false;
                setLocalState({ kind: "init" });
                setAuthAttempt((attempt) => attempt + 1);
              }}
              className="mini-btn-primary mini-press mt-5 w-full"
            >
              {t("action.retry")}
            </button>
          )}
          {/* Второй выход из этого экрана. «Аккаунт не связан с
              Telegram» — тоже тупик: повторять вход бессмысленно, пока
              руководитель не привяжет аккаунт. Телефон и пароль
              работают независимо от привязки. */}
          <div className="mt-2">
            <Link href="/mini/login" className="mini-btn-secondary mini-press w-full">
              {t("action.phoneLogin")}
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
        {t("loading.heading")}
      </div>
      <p className="text-[16px]" style={{ color: "var(--mini-text-muted)" }}>
        {t("loading.description")}
      </p>
    </div>
  );
}
