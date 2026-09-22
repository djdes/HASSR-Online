"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LegalConsentCheckbox } from "@/components/legal/legal-consent-checkbox";
import { ArrowRight, Loader2, Mail } from "lucide-react";
import { EmailHint, useEmailField } from "@/components/ui/email-field";
import {
  readSignupSource,
  rememberSignupSource,
  ymGoal,
} from "@/lib/signup-source";

/**
 * Стартовая форма лендинга: посетитель вводит почту — и аккаунт
 * создаётся сразу, без анкеты и кода из письма. Дальше он уже внутри
 * кабинета, а пароль уходит письмом.
 *
 * Почта здесь обязательна (в отличие от прежней версии, которая пускала
 * дальше и с пустым полем): без валидного адреса пароль доставить
 * некуда, и аккаунт окажется мёртвым.
 */
export function HeroEmailStart({
  tone = "light",
  buttonLabel = "Начать бесплатно",
  layout = "row",
  showLoginLink = true,
  place = "hero",
}: {
  /// Где стоит форма: hero | banner | demo | final. Уходит параметром в
  /// цели Метрики и в instant-register, а также даёт полю уникальный
  /// id — на странице таких форм несколько.
  place?: string;
  /// "dark" — для размещения на тёмной секции (финальный CTA).
  tone?: "light" | "dark";
  buttonLabel?: string;
  /// "stack" — поле во всю ширину, кнопка под ним. Так первый экран
  /// читается сверху вниз одной колонкой, без прыжка глазом вбок.
  layout?: "row" | "stack";
  /// Ссылка «Уже есть аккаунт» под формой. На первом экране не нужна —
  /// «Войти» стоит в шапке, и вторая точка входа только отвлекает.
  showLoginLink?: boolean;
}) {
  const router = useRouter();
  const field = useEmailField();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [consentMissing, setConsentMissing] = useState(false);
  const dark = tone === "dark";
  const inputId = `${place}-email`;
  const goalParams = { place };

  // Первое касание (посадочная, referrer, utm) запоминается при показе
  // формы — к моменту отправки человек мог уйти с исходной страницы.
  useEffect(() => {
    rememberSignupSource();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    field.setTouched(true);
    // Кнопка и так заблокирована при неверном адресе — это страховка на
    // случай отправки формы клавишей Enter.
    if (!field.valid) return;
    if (!consent) {
      setConsentMissing(true);
      setError("Отметьте согласие с документами — без него аккаунт не создаётся");
      return;
    }
    const value = field.value.trim().toLowerCase();

    setError(null);
    setLoading(true);
    // Имя цели прежнее — на него уже настроена Метрика; место формы
    // уходит параметром.
    ymGoal("hero_email_submit", goalParams);

    try {
      const res = await fetch("/api/auth/instant-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: value,
          source: readSignupSource(place),
          consent: true,
          consentPlace: "landing",
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.created) {
        ymGoal("instant_register_done", goalParams);
        ymGoal("signup_created", goalParams);
        router.push("/dashboard?welcome=1");
        router.refresh();
        return;
      }
      if (res.ok && data.exists) {
        // Аккаунт уже есть — уводим на вход с подсказкой и заполненной
        // почтой, чтобы человек не гадал, почему «не регистрируется».
        ymGoal("signup_exists", goalParams);
        router.push(`/login?email=${encodeURIComponent(value)}&exists=1`);
        return;
      }
      ymGoal("signup_error", { ...goalParams, code: String(res.status) });
      setError(data.error ?? "Не получилось — попробуйте ещё раз");
    } catch {
      ymGoal("signup_error", { ...goalParams, code: "network" });
      setError("Сеть недоступна. Попробуйте ещё раз");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[480px]">
      <form
        onSubmit={submit}
        className={
          layout === "stack"
            ? "flex flex-col gap-2.5"
            : "flex flex-col gap-2.5 sm:flex-row sm:gap-2"
        }
      >
        <label htmlFor={inputId} className="sr-only">
          Электронная почта
        </label>
        {/* Поле в обёртке с иконкой: голая рамка на светлом фоне первого
            экрана читалась как декоративная плашка, а не как место для
            ввода. Конверт слева и заметная высота возвращают ему вид
            обычного поля. */}
        <div className="relative w-full flex-1">
          <Mail
            aria-hidden="true"
            className={
              "pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 " +
              (dark ? "text-white/50" : "text-[#9b9fb3]")
            }
          />
          <input
            id={inputId}
            type="email"
            value={field.value}
            onChange={(e) => field.setValue(e.target.value)}
            onFocus={() => ymGoal("email_field_focus", goalParams)}
            placeholder="Ваш e-mail"
            autoComplete="email"
            inputMode="email"
            className={
              // 16px, а не 15: iOS Safari автоматически зумит страницу при
              // фокусе в поле со шрифтом меньше 16px и обратно уже не
              // отъезжает — это и был «непонятный zoom in» на лендинге.
              "h-[56px] w-full rounded-2xl border pl-11 pr-4 text-[16px] outline-none transition-colors focus:ring-4 sm:h-[60px] " +
              (dark
                ? "border-white/25 bg-white/10 text-white placeholder:text-white/55 focus:border-white/45 focus:ring-white/10"
                : "border-[#dcdfed] bg-white text-[#0b1024] shadow-[0_1px_2px_rgba(11,16,36,0.05)] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:ring-[#5566f6]/15")
            }
          />
        </div>
        <button
          type="submit"
          disabled={loading || !field.valid}
          className={
            "group inline-flex h-[56px] shrink-0 items-center justify-center gap-2 rounded-2xl px-6 text-[15px] font-semibold transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 sm:h-[60px] sm:px-7 sm:text-[16px] " +
            (layout === "stack" ? "w-full " : "") +
            (dark
              ? "bg-white text-[#0b1024] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.5)] hover:bg-white/90"
              : "bg-[#5566f6] text-white shadow-[0_20px_50px_-20px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0] hover:shadow-[0_24px_55px_-18px_rgba(85,102,246,0.65)]")
          }
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Создаём аккаунт…
            </>
          ) : (
            <>
              {buttonLabel}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </>
          )}
        </button>
      </form>

      <EmailHint
        check={field.check}
        touched={field.touched}
        domainState={field.domainState}
        onApply={field.applySuggestion}
        tone={tone}
      />

      <LegalConsentCheckbox
        checked={consent}
        onChange={(value) => {
          setConsent(value);
          if (value) {
            setConsentMissing(false);
            setError(null);
          }
        }}
        tone={dark ? "dark" : "light"}
        highlight={consentMissing}
        className="mt-2.5"
      />

      {/* Подсказки «аккаунт создадим сразу» под полем больше нет: на
          телефоне она сталкивала гарантию за сгиб. Что произойдёт после
          нажатия, говорит сама кнопка и зелёная строка гарантии под ней. */}
      {error ? (
        <p
          className={
            "mt-2.5 text-[13px] " + (dark ? "text-[#ffb4ab]" : "text-[#a13a32]")
          }
        >
          {error}
        </p>
      ) : null}

      <div
        className={
          "mt-3 text-[12px] " +
          (showLoginLink ? "" : "hidden ") +
          (dark ? "text-white/60" : "text-[#9b9fb3]")
        }
      >
        Уже есть аккаунт?{" "}
        <Link
          href="/login"
          className={
            "font-medium underline-offset-4 hover:underline " +
            (dark ? "text-white/90" : "text-[#3848c7]")
          }
        >
          Войти
        </Link>
      </div>
    </div>
  );
}
