"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Eye, EyeOff, Loader2, Send } from "lucide-react";

import { formatRuPhoneInput } from "@/lib/phone-input";
import { sanitizeMiniAppRedirectPath } from "@/lib/journal-obligation-links";

import { getTelegramWebApp } from "../_components/telegram-web-app";
import { clearSignedOutMark, telegramSignInHref } from "../_lib/signed-out-mark";

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
}: {
  next?: string;
  /** Номер из строки запроса — приходит с экрана «Готово» после QR-регистрации. */
  initialPhone?: string;
}) {
  const inTelegram = useTelegramInitData();
  const [mode, setMode] = useState<LoginMode>("phone");
  const [phone, setPhone] = useState(() =>
    initialPhone ? formatRuPhoneInput(initialPhone) : ""
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [leavingToTelegram, setLeavingToTelegram] = useState(false);
  // Второй шаг: код из Telegram, если включено в «Безопасности».
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const phoneRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Фокус в поле — только вне Telegram. Там сверху кнопка «Войти через
  // Telegram», а клавиатура, выехавшая сама, закрыла бы полэкрана и
  // подсказала бы «набирайте телефон», хотя вернуться можно одним нажатием.
  // Атрибутом `autoFocus` этого не сделать: сервер не знает, где открыт
  // экран, а браузер фокусирует поле по атрибуту ещё до гидратации.
  useEffect(() => {
    if (getTelegramWebApp()?.initData) return;
    (initialPhone ? passwordRef : phoneRef).current?.focus();
  }, [initialPhone]);

  /** Вошли: пометка «вышел вручную» больше не нужна — уходим, куда шли. */
  function finishLogin() {
    clearSignedOutMark();
    // Куда возвращать — только внутрь сайта: адрес приходит из строки
    // запроса, и без проверки он стал бы открытым редиректом.
    const target = next ? sanitizeMiniAppRedirectPath(next) : null;
    // Перезагрузка страницей, а не router.replace: `/mini` пускает по
    // `useSession().status`, а он живёт в уже смонтированном
    // SessionProvider и про свежую куку не узнает. Клиентский переход
    // вернул бы нас на этот же экран — вход бы «не срабатывал».
    window.location.assign(target ?? "/mini");
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

  function switchMode(nextMode: LoginMode) {
    setMode(nextMode);
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(LOGIN_ENDPOINT[mode], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "phone" ? { phone, password } : { email: email.trim(), password }
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Не удалось войти");
        return;
      }
      if (body.requiresCode && body.challengeId) {
        setChallengeId(String(body.challengeId));
        setCode("");
        return;
      }
      finishLogin();
    } catch {
      setError("Нет связи. Проверьте интернет и попробуйте ещё раз.");
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
        setError(body.error || "Неверный код");
        return;
      }
      finishLogin();
    } catch {
      setError("Нет связи. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  if (challengeId) {
    return (
      <form onSubmit={submitCode} className="mt-5 space-y-3">
        <p className="text-[16px] leading-[1.5]" style={{ color: "var(--mini-text-secondary)" }}>
          Пароль верный. Код отправлен в ваш Telegram, действует 5 минут.
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="000000"
          aria-label="Код из Telegram"
          // Крупно, как поле PIN QR-страниц.
          className="mini-input text-center tracking-[0.4em]"
          style={{ minHeight: 64, fontSize: 26, fontWeight: 700, fontFamily: "var(--mini-font-mono)" }}
        />
        {error ? (
          <p role="alert" className="mini-err">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || code.length !== 6}
          className="mini-btn-primary mini-press w-full"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : null}
          Подтвердить
        </button>
        <button
          type="button"
          onClick={() => {
            setChallengeId(null);
            setError(null);
          }}
          className="mini-btn-ghost mini-press w-full underline underline-offset-2"
        >
          Назад — отправить код ещё раз
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
            onClick={signInWithTelegram}
            disabled={leavingToTelegram}
            className="mini-btn-secondary mini-press w-full"
          >
            {leavingToTelegram ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <Send className="size-5" />
            )}
            Войти через Telegram
          </button>
          <p
            className="mt-2 text-[15px] leading-[1.5]"
            style={{ color: "var(--mini-text-muted)" }}
          >
            В аккаунт, к которому привязан этот Telegram.
          </p>
          <div className="mt-5 flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1" style={{ background: "var(--mini-divider-strong)" }} />
            <span className="mini-label">или другой аккаунт</span>
            <span className="h-px flex-1" style={{ background: "var(--mini-divider-strong)" }} />
          </div>
        </div>
      ) : null}

      {/* noValidate: подсказки браузера к полю почты — по-английски
          («Please include an '@'…»); проверяет сервер и отвечает по-русски. */}
      <form onSubmit={submit} noValidate className="mt-5 space-y-3">
        <div role="radiogroup" aria-label="Чем входить" className="mini-seg">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "phone"}
            onClick={() => switchMode("phone")}
            className="mini-press"
          >
            Телефон
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "email"}
            onClick={() => switchMode("email")}
            className="mini-press"
          >
            Почта
          </button>
        </div>

        {mode === "phone" ? (
          <div>
            <label htmlFor="phone" className="mini-label mb-1.5 block">
              Телефон
            </label>
            <input
              ref={phoneRef}
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(formatRuPhoneInput(e.target.value))}
              placeholder="+7 999 123-45-67"
              className="mini-input"
            />
          </div>
        ) : (
          <div>
            <label htmlFor="email" className="mini-label mb-1.5 block">
              Почта
            </label>
            <input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.ru"
              className="mini-input"
            />
          </div>
        )}

        <div>
          <label htmlFor="password" className="mini-label mb-1.5 block">
            Пароль
          </label>
          <div className="relative">
            <input
              ref={passwordRef}
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mini-input"
              style={{ paddingRight: 60 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              className="absolute right-1 top-1/2 flex size-12 -translate-y-1/2 items-center justify-center rounded-xl"
              style={{ color: "var(--mini-text-muted)" }}
            >
              {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
        </div>

        {/* Светлая тема: #ff6b6b на белом почти не читался. */}
        {error ? (
          <p role="alert" className="mini-err">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy || !password || (mode === "phone" ? !phone : !email.trim())}
          className="mini-btn-primary mini-press w-full"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : null}
          Войти
        </button>

        {/* Подсказка — для сотрудника: пароль ему выдаёт руководитель.
            Руководитель с почтой восстанавливает пароль сам, на сайте. */}
        {mode === "phone" ? (
          <p
            className="pt-1 text-[15px] leading-[1.5]"
            style={{ color: "var(--mini-text-muted)" }}
          >
            Забыли пароль? Руководитель выдаст новый — попросите его открыть
            вашу карточку в разделе «Сотрудники».
          </p>
        ) : null}
      </form>
    </>
  );
}
