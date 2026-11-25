"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Eye, EyeOff, Loader2, Phone, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { formatRuPhoneInput } from "@/lib/phone-input";
import { sanitizeMiniAppRedirectPath } from "@/lib/journal-obligation-links";

import { getTelegramWebApp, requestTelegramContact } from "../_components/telegram-web-app";
import { isInsideMobileApp } from "@/lib/mobile-app";
import { clearSignedOutMark, telegramSignInHref } from "../_lib/signed-out-mark";
import {
  miniLinkPhoneErrorKey,
  miniLoginErrorKey,
  type LoginErrorKey,
} from "./login-error-presentation";
import { useHydrated } from "@/lib/use-hydrated";

/**
 * Чем входит человек. Сотрудник знает свой телефон (почта у него
 * служебная), руководитель обычно входит почтой — после «Выйти» в
 * Telegram ему нужно попасть именно в свой аккаунт.
 */
type LoginMode = "phone" | "email";
/** Проверка пары у обоих входов — на сервере, общая с сайтом. */
const LOGIN_ENDPOINT: Record<LoginMode, string> = {
  phone: "/api/mini/login",
  email: "/api/auth/login",
};

const subscribeNever = () => () => {};

/**
 * Открыт ли экран внутри Telegram (есть подписанные данные). Сервер этого
 * не знает, поэтому при серверной отрисовке — «нет»: кнопка «Войти через
 * Telegram» появляется уже в браузере.
 */
function useTelegramInitData(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => Boolean(getTelegramWebApp()?.initData),
    () => false,
  );
}

/**
 * Форма входа сотрудника.
 *
 * Решения здесь продиктованы тем, кто ей пользуется: повар и уборщица,
 * на дешёвом андроиде, часто мокрыми руками, иногда в перчатках.
 *
 *   • `inputMode="tel"` — цифровая клавиатура, а не полная раскладка;
 *   • поля высотой 56px — попасть пальцем без прицеливания;
 *   • показ пароля — набрать вслепую с первого раза почти невозможно;
 *   • одна строка ошибки, без модалок и подробностей.
 *
 * Внутри Telegram сверху — «Войти через Telegram»: после «Выйти»
 * приложение само больше не входит (`_lib/signed-out-mark.ts`), и эта
 * кнопка возвращает в аккаунт, привязанный к Telegram. Форма под ней —
 * для другого аккаунта: по телефону или по почте.
 */
export function MiniLoginForm({
  next,
  initialPhone,
  linkTelegramDefault = false,
}: {
  next?: string;
  /** Номер из строки запроса — приходит с экрана «Готово» после QR-регистрации. */
  initialPhone?: string;
  /** Пришли с экрана «Telegram не привязан» — привязка включена по умолчанию. */
  linkTelegramDefault?: boolean;
}) {
  // До загрузки скриптов кнопка выключена: иначе браузер отправит форму сам (утечка пароля, 2026-11-24).
  const hydrated = useHydrated();
  const t = useTranslations("miniLogin");
  const tError = useTranslations("miniLogin.errors");
  const inTelegram = useTelegramInitData();
  const [mode, setMode] = useState<LoginMode>("phone");
  const [phone, setPhone] = useState(() =>
    initialPhone ? formatRuPhoneInput(initialPhone) : ""
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<LoginErrorKey | null>(null);
  const [fieldError, setFieldError] = useState<{
    field: "phone" | "email" | "password";
    key: LoginErrorKey;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [leavingToTelegram, setLeavingToTelegram] = useState(false);
  const [sharingPhone, setSharingPhone] = useState(false);
  const [linkOnLogin, setLinkOnLogin] = useState(true);
  // Второй шаг: код из Telegram, если включено в «Безопасности».
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (linkTelegramDefault) setLinkOnLogin(true);
  }, [linkTelegramDefault]);

  // Фокус в поле — только вне Telegram. Там сверху кнопка «Войти через
  // Telegram», а клавиатура, выехавшая сама, закрыла бы полэкрана и
  // подсказала бы «набирайте телефон», хотя вернуться можно одним нажатием.
  // Атрибутом `autoFocus` этого не сделать: сервер не знает, где открыт
  // экран, а браузер фокусирует поле по атрибуту ещё до гидратации.
  // В приложении WeSetup тоже без фокуса: на iPhone клавиатура, открытая
  // сама, закрывала пароль и «Войти» — человек видел одно поле телефона.
  useEffect(() => {
    if (getTelegramWebApp()?.initData || isInsideMobileApp()) return;
    (initialPhone ? passwordRef : phoneRef).current?.focus();
  }, [initialPhone]);

  // Клавиатура телефона не должна закрывать «Войти»: когда она выехала,
  // подкручиваем страницу так, чтобы кнопка была над ней.
  const submitRef = useRef<HTMLButtonElement>(null);
  function keepSubmitVisible() {
    window.setTimeout(() => revealAboveKeyboard(submitRef.current), 350);
  }

  // Клавиша ввода в телефоне или почте — к паролю; в пароле — «Войти».
  function focusPasswordOnEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key !== "Enter" || password) return;
    event.preventDefault();
    passwordRef.current?.focus();
  }

  /** Вошли: пометка «вышел вручную» больше не нужна — уходим, куда шли. */
  function finishLogin(fallbackHref?: string) {
    clearSignedOutMark();
    // Куда возвращать — только внутрь сайта: адрес приходит из строки
    // запроса, и без проверки он стал бы открытым редиректом.
    const target = next ? sanitizeMiniAppRedirectPath(next) : null;
    const safeFallback =
      typeof fallbackHref === "string" && fallbackHref.startsWith("/")
        ? fallbackHref
        : "/mini";
    // Перезагрузка страницей, а не router.replace: `/mini` пускает по
    // `useSession().status`, а он живёт в уже смонтированном
    // SessionProvider и про свежую куку не узнает. Клиентский переход
    // вернул бы нас на этот же экран — вход бы «не срабатывал».
    window.location.assign(target ?? safeFallback);
  }

  /**
   * «Войти через Telegram» — тот же вход, что при открытии из бота:
   * снимаем пометку, и `/mini` войдёт по initData сам, как раньше.
   */
  function signInWithTelegram() {
    setLeavingToTelegram(true);
    clearSignedOutMark();
    window.location.assign(telegramSignInHref(next));
  }

  async function handleSharePhoneLogin() {
    if (sharingPhone || leavingToTelegram || busy) return;
    const initData = getTelegramWebApp()?.initData;
    if (!initData) {
      setError("loginFailed");
      return;
    }
    setSharingPhone(true);
    setError(null);
    setFieldError(null);
    try {
      const contact = await requestTelegramContact();
      if (contact.status === "cancelled") {
        setError("contactDeclined");
        return;
      }
      if (contact.status === "unsupported") {
        setError("loginFailed");
        return;
      }
      const postLink = async (contactResponse?: string) => {
        const res = await fetch("/api/mini/link-telegram-phone", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            contactResponse ? { initData, contactResponse } : { initData },
          ),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          status?: string;
          homeHref?: string;
        };
        return { res, body };
      };

      const first = await postLink(contact.response);
      if (first.res.ok && first.body.ok) {
        finishLogin(first.body.homeHref);
        return;
      }
      if (first.res.status === 202 || first.body.status === "pending_bot_contact") {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 1500));
          const poll = await postLink();
          if (poll.res.ok && poll.body.ok) {
            finishLogin(poll.body.homeHref);
            return;
          }
          if (poll.res.status !== 202 && poll.body.status !== "pending_bot_contact") {
            setError(miniLinkPhoneErrorKey(poll.body.status));
            return;
          }
        }
        setError("contactPending");
        return;
      }
      setError(miniLinkPhoneErrorKey(first.body.status));
    } catch {
      setError("connectionFailed");
    } finally {
      setSharingPhone(false);
    }
  }

  function switchMode(nextMode: LoginMode) {
    setMode(nextMode);
    setError(null);
    setFieldError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    if (mode === "phone" && !phone.trim()) {
      setFieldError({ field: "phone", key: "phoneRequired" });
      setError("phoneRequired");
      phoneRef.current?.focus();
      return;
    }
    if (mode === "email" && !email.trim()) {
      setFieldError({ field: "email", key: "emailRequired" });
      setError("emailRequired");
      emailRef.current?.focus();
      return;
    }
    if (!password) {
      const key: LoginErrorKey = mode === "phone" ? "phoneRequired" : "emailRequired";
      setFieldError({ field: "password", key });
      setError(key);
      passwordRef.current?.focus();
      return;
    }

    setBusy(true);
    setError(null);
    setFieldError(null);

    try {
      const initData = inTelegram ? getTelegramWebApp()?.initData : undefined;
      const telegramPayload =
        inTelegram && linkOnLogin && initData
          ? { initData, linkTelegram: true }
          : {};
      const res = await fetch(LOGIN_ENDPOINT[mode], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "phone"
            ? { phone, password, ...telegramPayload }
            : { email: email.trim(), password, ...telegramPayload }
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(miniLoginErrorKey(body.error));
        return;
      }
      if (body.requiresCode && body.challengeId) {
        setChallengeId(String(body.challengeId));
        setCode("");
        return;
      }
      if (body.telegramLinkStatus === "linked" || body.telegramLinkStatus === "already_linked") {
        toast.success(t("telegram.linkedToast"));
      } else if (body.telegramLinkStatus === "conflict") {
        toast.warning(t("telegram.conflictToast"));
      } else if (body.telegramLinkStatus === "user_already_linked_other_tg") {
        toast.warning(t("telegram.userOtherTgToast"));
      }
      finishLogin();
    } catch {
      setError("connectionFailed");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !challengeId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(miniLoginErrorKey(body.error, true));
        return;
      }
      finishLogin();
    } catch {
      setError("connectionFailed");
    } finally {
      setBusy(false);
    }
  }

  if (challengeId) {
    return (
      <form method="post" onSubmit={submitCode} className="mt-5 space-y-3">
        <p className="text-[16px] leading-[1.5]" style={{ color: "var(--mini-text-secondary)" }}>
          {t("challenge.instructions")}
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder={t("challenge.codePlaceholder")}
          aria-label={t("challenge.codeLabel")}
          // Крупно, как поле PIN QR-страниц.
          className="mini-input text-center tracking-[0.4em]"
          style={{ minHeight: 64, fontSize: 26, fontWeight: 700, fontFamily: "var(--mini-font-mono)" }}
        />
        {error ? (
          <p role="alert" className="mini-err">
            {tError(error)}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || code.length !== 6 || !hydrated}
          aria-busy={busy}
          aria-label={busy ? t("actions.confirmingCode") : t("actions.confirmCode")}
          className="mini-btn-primary mini-press w-full"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : null}
          {t("actions.confirmCode")}
        </button>
        <button
          type="button"
          onClick={() => {
            setChallengeId(null);
            setError(null);
          }}
          className="mini-btn-ghost mini-press w-full underline underline-offset-2"
        >
          {t("actions.retryCode")}
        </button>
      </form>
    );
  }

  return (
    <>
      {inTelegram ? (
        <div className="mt-5">
          <button
            type="button"
            onClick={handleSharePhoneLogin}
            disabled={sharingPhone || leavingToTelegram || busy}
            aria-busy={sharingPhone}
            className="mini-btn-primary mini-press w-full"
          >
            {sharingPhone ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : (
              <Phone className="size-5" aria-hidden />
            )}
            {sharingPhone ? t("telegram.sharingPhone") : t("telegram.sharePhone")}
          </button>
          <button
            type="button"
            onClick={signInWithTelegram}
            disabled={leavingToTelegram || sharingPhone}
            className="mini-btn-secondary mini-press mt-2 w-full"
          >
            {leavingToTelegram ? (
              <Loader2 className="size-5 animate-spin" aria-hidden />
            ) : (
              <Send className="size-5" aria-hidden />
            )}
            {leavingToTelegram ? t("actions.switchingToTelegram") : t("telegram.login")}
          </button>
          <p
            className="mt-2 text-[15px] leading-[1.5]"
            style={{ color: "var(--mini-text-muted)" }}
          >
            {t("telegram.accountInfo")}
          </p>
          <div className="mt-5 flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1" style={{ background: "var(--mini-divider-strong)" }} />
            <span className="mini-label">{t("telegram.otherAccount")}</span>
            <span className="h-px flex-1" style={{ background: "var(--mini-divider-strong)" }} />
          </div>
        </div>
      ) : null}

      {/* noValidate: подсказки браузера к полю почты — по-английски
          («Please include an '@'…»); проверяет сервер и отвечает по-русски. */}
      <form method="post" onSubmit={submit} onFocus={keepSubmitVisible} noValidate className="mt-5 space-y-3">
        <div role="radiogroup" aria-label={t("mode.label")} className="mini-seg">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "phone"}
            onClick={() => switchMode("phone")}
            className="mini-press"
          >
            {t("mode.phone")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "email"}
            onClick={() => switchMode("email")}
            className="mini-press"
          >
            {t("mode.email")}
          </button>
        </div>

        {mode === "phone" ? (
          <div>
            <label htmlFor="phone" className="mini-label mb-1.5 block">
              {t("fields.phone")}
            </label>
            <input
              ref={phoneRef}
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              enterKeyHint="next"
              onKeyDown={focusPasswordOnEnter}
              autoComplete="tel"
              value={phone}
              onChange={(e) => {
                setPhone(formatRuPhoneInput(e.target.value));
                if (fieldError?.field === "phone") setFieldError(null);
              }}
              aria-invalid={fieldError?.field === "phone" || undefined}
              aria-describedby={fieldError?.field === "phone" ? "mini-login-error" : undefined}
              placeholder={t("fields.phonePlaceholder")}
              className="mini-input"
            />
          </div>
        ) : (
          <div>
            <label htmlFor="email" className="mini-label mb-1.5 block">
              {t("fields.email")}
            </label>
            <input
              ref={emailRef}
              id="email"
              name="email"
              type="email"
              inputMode="email"
              enterKeyHint="next"
              onKeyDown={focusPasswordOnEnter}
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldError?.field === "email") setFieldError(null);
              }}
              aria-invalid={fieldError?.field === "email" || undefined}
              aria-describedby={fieldError?.field === "email" ? "mini-login-error" : undefined}
              placeholder={t("fields.emailPlaceholder")}
              className="mini-input"
            />
          </div>
        )}

        <div>
          <label htmlFor="password" className="mini-label mb-1.5 block">
            {t("fields.password")}
          </label>
          <div className="relative">
            <input
              ref={passwordRef}
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              enterKeyHint="go"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldError?.field === "password") setFieldError(null);
              }}
              aria-invalid={fieldError?.field === "password" || undefined}
              aria-describedby={fieldError?.field === "password" ? "mini-login-error" : undefined}
              className="mini-input"
              style={{ paddingRight: 60 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              aria-label={showPassword ? t("fields.hidePassword") : t("fields.showPassword")}
              className="absolute right-1 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-xl"
              style={{ color: "var(--mini-text-muted)" }}
            >
              {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
        </div>

        {inTelegram ? (
          <label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl px-1 py-2">
            <input
              type="checkbox"
              checked={linkOnLogin}
              onChange={(e) => setLinkOnLogin(e.target.checked)}
              className="mt-1 size-5 shrink-0 accent-[#5566f6]"
            />
            <span className="min-w-0 flex-1">
              <span
                className="block text-[15px] font-semibold leading-snug"
                style={{ color: "var(--mini-text)" }}
              >
                {t("telegram.linkOnLogin")}
              </span>
              <span
                className="mt-0.5 block text-[13.5px] leading-snug"
                style={{ color: "var(--mini-text-muted)" }}
              >
                {t("telegram.linkOnLoginHint")}
              </span>
            </span>
          </label>
        ) : null}

        {/* Светлая тема: #ff6b6b на белом почти не читался. */}
        {error ? (
          <p id="mini-login-error" role="alert" className="mini-err">
            {tError(error)}
          </p>
        ) : null}

        <button
          ref={submitRef}
          type="submit"
          disabled={busy || !hydrated}
          aria-busy={busy}
          aria-label={busy ? t("actions.loggingIn") : t("actions.login")}
          className="mini-btn-primary mini-press w-full"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : null}
          {busy ? <span className="sr-only">{t("actions.loggingIn")}</span> : t("actions.login")}
        </button>

        {/* Подсказка — для сотрудника: пароль ему выдаёт руководитель.
            Руководитель с почтой восстанавливает пароль сам, на сайте. */}
        {mode === "phone" ? (
          <p
            className="pt-1 text-[15px] leading-[1.5]"
            style={{ color: "var(--mini-text-muted)" }}
          >
            {t("help.forgotPassword")}
          </p>
        ) : null}
      </form>
    </>
  );
}

/**
 * Показать элемент над клавиатурой телефона: видимая область — это
 * `visualViewport` (без клавиатуры), а не окно. Крутим ближайший
 * прокручиваемый блок или страницу.
 */
function revealAboveKeyboard(el: HTMLElement | null) {
  if (!el || typeof window === "undefined") return;
  const viewport = window.visualViewport;
  const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
  const overflow = el.getBoundingClientRect().bottom + 16 - visibleBottom;
  if (overflow <= 0) return;
  let parent: HTMLElement | null = el.parentElement;
  while (parent) {
    const overflowY = getComputedStyle(parent).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && parent.scrollHeight > parent.clientHeight) {
      parent.scrollBy({ top: overflow, behavior: "smooth" });
      return;
    }
    parent = parent.parentElement;
  }
  window.scrollBy({ top: overflow, behavior: "smooth" });
}
