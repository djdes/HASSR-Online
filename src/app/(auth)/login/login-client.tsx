"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { BrandLogo } from "@/components/brand/logo";
import { ArrowRight, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { looksLikePhoneInput, phoneQueryValue } from "@/lib/login-identifier";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const registered = searchParams.get("registered") === "true";
  const inviteAccepted = searchParams.get("invite") === "accepted";
  // Пришли с лендинга, где почта уже занята: подставляем её и объясняем,
  // почему вместо регистрации показан вход.
  const alreadyExists = searchParams.get("exists") === "1";
  // Куда вести после входа. Только внутренний путь — чужие адреса
  // (open redirect) отбрасываем и идём в кабинет.
  const nextPath = (() => {
    const raw = searchParams.get("next") ?? "";
    return raw.startsWith("/") && !raw.startsWith("//") && raw.length <= 500 ? raw : "/dashboard";
  })();
  const prefilledEmail = (() => {
    const raw = searchParams.get("email")?.trim().toLowerCase() ?? "";
    return raw.includes("@") && raw.length <= 200 ? raw : "";
  })();

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    email: prefilledEmail,
    password: "",
  });
  // Второй шаг входа: код из Telegram (если человек включил в «Безопасности»).
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [magicState, setMagicState] = useState<"idle" | "sending" | "sent">("idle");
  const magicReason = searchParams.get("magic");
  async function requestMagicLink() {
    const email = formData.email.trim();
    if (!email) {
      setError("Введите почту — на неё придёт ссылка для входа");
      return;
    }
    setMagicState("sending");
    setError(null);
    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error || "Не удалось отправить письмо");
        setMagicState("idle");
        return;
      }
      setMagicState("sent");
    } catch {
      setError("Ошибка соединения с сервером");
      setMagicState("idle");
    }
  }
  const [forgotState, setForgotState] = useState<"idle" | "sending" | "sent">(
    "idle",
  );

  /**
   * Восстановление доступа. Ответ сервера всегда одинаковый (чтобы нельзя
   * было перебирать чужие почты), поэтому и текст здесь нейтральный.
   */
  async function requestReset() {
    const email = formData.email.trim().toLowerCase();
    if (!email.includes("@")) {
      setError("Введите email — на него придёт ссылка для смены пароля");
      return;
    }
    setForgotState("sending");
    try {
      await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setForgotState("sent");
    } catch {
      setForgotState("idle");
      setError("Не удалось отправить письмо. Попробуйте ещё раз");
    }
  }

  // Вход по телефону живёт в мобильном кабинете: здесь только почта.
  // Считаем это не ошибкой, а поводом подсказать дорогу.
  const phoneTyped = looksLikePhoneInput(formData.email);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (phoneTyped) {
      setError(null);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        // Раньше ошибка всегда подменялась на «Неверный email или
        // пароль». При rate-limit'е (429) пользователь продолжал
        // тыкать и недоумевал. Теперь показываем серверный текст
        // если есть — там и про rate-limit, и про пустые поля.
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error || "Неверный email или пароль");
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        requiresCode?: boolean;
        challengeId?: string;
      } | null;
      if (data?.requiresCode && data.challengeId) {
        setChallengeId(data.challengeId);
        setCode("");
        return;
      }
      router.push(nextPath);
      router.refresh();
    } catch {
      setError("Ошибка соединения с сервером");
    } finally {
      setLoading(false);
    }
  }

  async function handleCode(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeId) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, code }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error || "Неверный код");
        return;
      }
      router.push(nextPath);
      router.refresh();
    } catch {
      setError("Ошибка соединения с сервером");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
      {/* Left: brand panel */}
      <aside className="relative hidden flex-col overflow-hidden bg-[#0b1024] p-12 text-white lg:flex">
        {/* Soft mesh gradient backdrop */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 size-[520px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
          <div className="absolute -bottom-40 -right-32 size-[560px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
          <div className="absolute left-1/3 top-1/2 size-[340px] rounded-full bg-[#3d4efc] opacity-30 blur-[100px]" />
        </div>
        {/* Grid overlay */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.8) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse at 40% 40%, black 40%, transparent 70%)",
          }}
        />

        <div className="relative z-10 flex flex-col">
          {/* Тот же знак, что в шапке лендинга и в футере — один бренд
              на всех публичных экранах. */}
          <Link href="/" className="text-white" aria-label="WeSetup — на главную">
            <BrandLogo height={26} title="" />
          </Link>
        </div>

        <div className="relative z-10 mt-auto max-w-[520px]">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12px] uppercase tracking-[0.18em] text-white/70 backdrop-blur">
            <span className="size-1.5 rounded-full bg-[#7cf5c0]" />
            35 СанПиН / ХАССП журналов
          </div>
          <h1 className="text-[46px] font-semibold leading-[1.05] tracking-[-0.03em]">
            Электронные журналы пищевого производства
          </h1>
          <p className="mt-5 max-w-[440px] text-[16px] leading-[1.6] text-white/70">
            Контроль температур, санитарии и прослеживаемости сырья — в одном
            месте. Telegram-уведомления, импорт iiko, печать в формате
            Роспотребнадзора.
          </p>

          <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 text-[14px] text-white/80">
            {[
              "Базовый + Расширенный тарифы",
              "Доступ по ролям и журналам",
              "Уведомления в Telegram",
              "Автозаполнение с датчиков",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <CheckCircle2 className="size-4 text-[#7cf5c0]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <div className="mt-10 flex items-center gap-4 text-[12px] text-white/50">
            <span>© 2026 WeSetup</span>
            <span className="size-1 rounded-full bg-white/25" />
            <Link
              href="/register"
              className="underline-offset-4 hover:text-white hover:underline"
            >
              Зарегистрировать компанию
            </Link>
          </div>
        </div>
      </aside>

      {/* Right: auth card */}
      <main className="relative flex items-center justify-center px-6 py-12 sm:px-10">
        {/* Subtle paper grid */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "radial-gradient(#d9dceb 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />

        <div className="relative w-full max-w-[420px]">
          {/* Mobile brand header */}
          <div className="mb-8 lg:hidden">
            <Link href="/" className="text-[#0b1024]" aria-label="WeSetup — на главную">
              <BrandLogo height={24} title="" />
            </Link>
          </div>

          <h2 className="text-[clamp(1.5rem,2vw+1rem,2rem)] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
            Вход в личный кабинет
          </h2>
          <p className="mt-2 text-[14px] text-[#6f7282]">
            {challengeId
              ? "Второй шаг: код из Telegram."
              : "Введите email и пароль, выданные вашей компанией."}
          </p>

          {alreadyExists && (
            <div className="mt-6 flex items-start gap-2 rounded-2xl border border-[#dcdfed] bg-[#f5f6ff] px-4 py-3 text-[13px] text-[#3c4053]">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
              <span>
                Аккаунт с этой почтой уже есть — введите пароль. Не помните
                его? Нажмите «Забыли пароль?» ниже.
              </span>
            </div>
          )}

          {(registered || inviteAccepted) && (
            <div className="mt-6 flex items-start gap-2 rounded-2xl border border-[#c8f0d5] bg-[#effaf1] px-4 py-3 text-[13px] text-[#136b2a]">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <span>
                {registered
                  ? "Регистрация завершена. Войдите в систему."
                  : "Приглашение принято. Войдите под своим паролем."}
              </span>
            </div>
          )}

          {error && (
            <div
              className="mt-6 rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] px-4 py-3 text-[13px] text-[#d2453d]"
              role="alert"
            >
              {error}
            </div>
          )}

          {challengeId ? (
            <form onSubmit={handleCode} className="mt-8 space-y-5">
              <div className="rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4 text-[13.5px] leading-relaxed text-[#3c4053]">
                Пароль верный. Мы отправили код в ваш Telegram — введите его, код действует 5 минут.
              </div>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                placeholder="000000"
                aria-label="Код из Telegram"
                className="h-14 w-full rounded-2xl border border-[#dcdfed] bg-white text-center font-mono text-[24px] tracking-[0.4em] text-[#0b1024] placeholder:text-[#c9ccdb] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60"
              >
                {loading ? "Проверяем…" : "Подтвердить"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setChallengeId(null);
                  setError(null);
                }}
                className="w-full text-center text-[13px] text-[#6f7282] underline underline-offset-2"
              >
                Назад — отправить код ещё раз
              </button>
            </form>
          ) : null}
          <form onSubmit={handleSubmit} className="mt-8 space-y-5" hidden={Boolean(challengeId)}>
            {/* type="text": со встроенной проверкой браузер показывал
                английское «Please include an '@'…», когда сотрудник
                вводил телефон. Проверяем сами и объясняем по-русски. */}
            <Field
              id="email"
              label="Email"
              type="text"
              inputMode="email"
              value={formData.email}
              onChange={(v) => setFormData((p) => ({ ...p, email: v }))}
              placeholder="name@company.com"
              autoComplete="email"
              required
            />

            {phoneTyped ? (
              <p className="rounded-2xl border border-[#ffe9b0] bg-[#fffaf0] px-4 py-3 text-[13px] leading-[1.55] text-[#8a5a00]">
                Похоже, вы ввели номер телефона. На этой странице вход по
                почте. Сотрудникам —{" "}
                <Link
                  href={`/mini/login?phone=${encodeURIComponent(
                    phoneQueryValue(formData.email)
                  )}`}
                  className="font-medium text-[#3848c7] underline underline-offset-2"
                >
                  Вход по номеру телефона
                </Link>
                .
              </p>
            ) : null}

            <Field
              id="password"
              label="Пароль"
              type={showPassword ? "text" : "password"}
              value={formData.password}
              onChange={(v) => setFormData((p) => ({ ...p, password: v }))}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              adornment={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="rounded-lg p-1 text-[#8a8ea4] transition-colors hover:text-[#5566f6] focus:outline-none focus-visible:text-[#5566f6]"
                  aria-label={
                    showPassword ? "Скрыть пароль" : "Показать пароль"
                  }
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              }
            />

            <button
              type="submit"
              disabled={loading}
              className="group relative flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-[#5566f6] text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-all hover:bg-[#4a5bf0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-70"
            >
              <span className="relative z-10">
                {loading ? "Вход..." : "Войти"}
              </span>
              {!loading && (
                <ArrowRight className="relative z-10 size-4 transition-transform group-hover:translate-x-0.5" />
              )}
              <span
                aria-hidden
                className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full"
              />
            </button>
          </form>

          {magicReason ? (
            <p className="mt-4 rounded-2xl border border-[#ffe9b0] bg-[#fffaf0] px-4 py-3 text-[13px] text-[#8a5a00]" role="status">
              {magicReason === "expired"
                ? "Ссылка из письма устарела — запросите новую."
                : magicReason === "used"
                  ? "Эта ссылка уже использована — запросите новую."
                  : magicReason === "two-factor"
                    ? "У вас включён код в Telegram: войдите по паролю, ссылка из письма его не заменяет."
                    : "Ссылка не подошла — запросите новую."}
            </p>
          ) : null}
          {magicState === "sent" ? (
            <p className="mt-4 rounded-2xl border border-[#c8f0d5] bg-[#effaf1] px-4 py-3 text-[13px] text-[#136b2a]" data-testid="magic-sent">
              Если аккаунт с такой почтой есть, ссылка для входа уже отправлена. Она действует 15 минут.
            </p>
          ) : (
            <button
              type="button"
              onClick={requestMagicLink}
              disabled={magicState === "sending"}
              data-testid="magic-link-button"
              className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
            >
              {magicState === "sending" ? "Отправляем письмо…" : "Войти по ссылке из письма"}
            </button>
          )}
          {forgotState === "sent" ? (
            <p className="mt-4 rounded-2xl border border-[#c8f0d5] bg-[#effaf1] px-4 py-3 text-[13px] text-[#136b2a]">
              Если аккаунт с такой почтой существует, письмо со ссылкой для
              смены пароля уже отправлено. Проверьте входящие и папку «Спам».
            </p>
          ) : (
            <button
              type="button"
              onClick={requestReset}
              disabled={forgotState === "sending"}
              className="mt-4 w-full text-center text-[13px] text-[#6f7282] underline-offset-4 transition-colors hover:text-[#3848c7] hover:underline disabled:opacity-60"
            >
              {forgotState === "sending"
                ? "Отправляем письмо…"
                : "Забыли пароль?"}
            </button>
          )}

          <div className="mt-8 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#ececf4]" />
            <span className="text-[12px] uppercase tracking-[0.2em] text-[#9b9fb3]">
              или
            </span>
            <div className="h-px flex-1 bg-[#ececf4]" />
          </div>

          <Link
            href="/register"
            className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white text-[15px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            Зарегистрировать компанию
            <ArrowRight className="size-4 text-[#5566f6]" />
          </Link>

          <p className="mt-8 text-center text-[12px] text-[#9b9fb3]">
            Забыли пароль? Попросите администратора вашей организации выслать
            приглашение повторно.
          </p>
        </div>
      </main>
    </div>
  );
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
  adornment,
  inputMode,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  adornment?: React.ReactNode;
  inputMode?: "email" | "tel" | "text";
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-[#0b1024]">
        {label}
      </span>
      <div className="group relative flex items-center">
        <input
          id={id}
          name={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          required={required}
          // text-[16px]: ниже 16px iOS Safari зумит страницу при фокусе
          // в поле и не возвращает масштаб обратно.
          className="peer h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 pr-11 text-[16px] text-[#0b1024] placeholder:text-[#c1c5d6] transition-[border-color,box-shadow] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        />
        {adornment ? (
          <div className="absolute right-3 flex items-center">{adornment}</div>
        ) : null}
      </div>
    </label>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
