"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { formatRuPhoneInput } from "@/lib/phone-input";
import { sanitizeMiniAppRedirectPath } from "@/lib/journal-obligation-links";

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
 */
export function MiniLoginForm({
  next,
  initialPhone,
}: {
  next?: string;
  /** Номер из строки запроса — приходит с экрана «Готово» после QR-регистрации. */
  initialPhone?: string;
}) {
  const [phone, setPhone] = useState(() =>
    initialPhone ? formatRuPhoneInput(initialPhone) : ""
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Второй шаг: код из Telegram, если включено в «Безопасности».
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/mini/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
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
      // Куда возвращать — только внутрь /mini: адрес приходит из
      // строки запроса, и без проверки он стал бы открытым редиректом.
      const target = next ? sanitizeMiniAppRedirectPath(next) : null;
      // Перезагрузка страницей, а не router.replace: `/mini` пускает по
      // `useSession().status`, а он живёт в уже смонтированном
      // SessionProvider и про свежую куку не узнает. Клиентский переход
      // вернул бы нас на этот же экран — вход бы «не срабатывал».
      window.location.assign(target ?? "/mini");
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
      const target = next ? sanitizeMiniAppRedirectPath(next) : null;
      window.location.assign(target ?? "/mini");
    } catch {
      setError("Нет связи. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  if (challengeId) {
    return (
      <form onSubmit={submitCode} className="mt-5 space-y-3">
        <p className="text-[14px] leading-[1.55] opacity-80">
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
          className="mini-input h-14 w-full rounded-2xl px-4 text-center font-mono text-[24px] tracking-[0.4em]"
        />
        {error ? (
          <p
            role="alert"
            className="text-[14px] leading-[1.5]"
            style={{ color: "var(--mini-crimson)" }}
          >
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || code.length !== 6}
          className="mini-btn-primary mini-press h-14 w-full text-[16px] disabled:opacity-50"
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
          className="w-full text-center text-[13px] underline underline-offset-2 opacity-70"
        >
          Назад — отправить код ещё раз
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-3">
      <div>
        <label htmlFor="phone" className="mb-1.5 block text-[13px] opacity-70">
          Телефон
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          autoFocus={!initialPhone}
          value={phone}
          onChange={(e) => setPhone(formatRuPhoneInput(e.target.value))}
          placeholder="+7 999 123-45-67"
          className="mini-input h-14 w-full rounded-2xl px-4 text-[17px]"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-[13px] opacity-70">
          Пароль
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            autoFocus={Boolean(initialPhone)}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mini-input h-14 w-full rounded-2xl px-4 pr-14 text-[17px]"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
            className="absolute right-2 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-xl opacity-70"
          >
            {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </div>
      </div>

      {/* Светлая тема: #ff6b6b на белом почти не читался. */}
      {error ? (
        <p
          role="alert"
          className="text-[14px] leading-[1.5]"
          style={{ color: "var(--mini-crimson)" }}
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy || !phone || !password}
        className="mini-btn-primary mini-press h-14 w-full text-[16px] disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-5 animate-spin" /> : null}
        Войти
      </button>

      <p className="pt-1 text-[13px] leading-[1.5] opacity-60">
        Забыли пароль? Руководитель выдаст новый — попросите его открыть
        вашу карточку в разделе «Сотрудники».
      </p>
    </form>
  );
}
