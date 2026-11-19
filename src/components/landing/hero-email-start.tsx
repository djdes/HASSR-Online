"use client";

import { browserTimeZone } from "@/lib/geo-places";
import { useTranslations } from "next-intl";
import { useSiteLocale } from "@/components/i18n/site-locale-provider";
import { localizedHref } from "@/i18n/site-locale";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/i18n/localized-link";
import { LegalConsentCheckbox } from "@/components/legal/legal-consent-checkbox";
import { ArrowRight, CheckCircle2, Loader2, Mail, MousePointerClick } from "lucide-react";
import { LiveGuideStartButton } from "@/components/live-guide/live-guide-host";
import { useEmailField } from "@/components/ui/email-field";
import { useRegistrationChallenge } from "@/components/auth/registration-challenge";
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
  buttonLabel,
  layout = "row",
  showLoginLink = true,
  place = "hero",
  align = "center",
  showLiveGuide = true,
}: {
  /// Где стоит форма: hero | final. Уходит параметром в цели Метрики и
  /// в instant-register, а также даёт полю уникальный id — на странице
  /// таких форм несколько.
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
  /// "start" — форма у левого края колонки (финальный блок: заголовок и
  /// шаги там слева, форма по центру под ними смотрелась отдельно).
  align?: "center" | "start";
  /// Ссылка «Не знаете, с чего начать?» (живой гид). На главной её нет
  /// (правки 18.11.2026): под формой и так согласие и гарантия.
  showLiveGuide?: boolean;
}) {
  const t = useTranslations("landingComponents.heroEmail");
  const fieldT = useTranslations("auth.emailField");
  const errorT = useTranslations("publicUi.registrationErrors");
  const locale = useSiteLocale();
  const router = useRouter();
  const field = useEmailField();
  const challenge = useRegistrationChallenge();
  // Кнопка — одна форма на весь путь: кнопка → индикатор → галочка
  // (`motion-submit` в globals.css меняет ширину и скругление по `data-state`).
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const loading = status !== "idle";
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [consentMissing, setConsentMissing] = useState(false);
  const dark = tone === "dark";
  const inputId = `${place}-email`;
  // Подсказки о почте — внутри поля справа (правки 19.11.2026): строка под
  // полем сдвигала страницу на каждый символ. Опечатка в домене — кнопка
  // «→ gmail.com», проверка домена — индикатор, верный адрес — галочка.
  // Об ошибке говорим коротко и только когда человек ушёл из поля: пока он
  // печатает «name» без «@», это ещё не ошибка.
  const [blurred, setBlurred] = useState(false);
  const typo = field.check.status === "typo" ? field.check.suggestion : null;
  const fieldError =
    !field.touched || !blurred || typo
      ? null
      : field.check.status === "invalid"
        ? field.check.code === "missingAt"
          ? fieldT("short.missingAt")
          : fieldT("short.invalid")
        : field.check.status === "ok" && field.domainState === "missing"
          ? fieldT("short.domainMissing")
          : null;
  const fieldOk = field.check.status === "ok" && field.domainState === "ok";
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
    if (loading || !field.valid) return;
    if (!consent) {
      setConsentMissing(true);
      setError(t("consentRequired"));
      return;
    }
    const value = field.value.trim().toLowerCase();

    setError(null);
    setStatus("loading");
    // Имя цели прежнее — на него уже настроена Метрика; место формы
    // уходит параметром.
    ymGoal("hero_email_submit", goalParams);

    try {
      const res = await fetch("/api/auth/instant-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: value,
          locale,
          source: readSignupSource(place),
          consent: true,
          consentPlace: "landing",
          captchaToken: await challenge.getToken(),
          website: challenge.website,
          // Пояс браузера — пояс новой организации (время в журналах).
          timeZone: browserTimeZone(),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.created) {
        ymGoal("instant_register_done", goalParams);
        ymGoal("signup_created", goalParams);
        // Галочка успевает нарисоваться, прежде чем страница уйдёт в кабинет.
        setStatus("done");
        await new Promise((resolve) => window.setTimeout(resolve, 520));
        window.location.assign("/dashboard?welcome=1");
        return;
      }
      if (res.ok && data.exists) {
        // Аккаунт уже есть — уводим на вход с подсказкой и заполненной
        // почтой, чтобы человек не гадал, почему «не регистрируется».
        ymGoal("signup_exists", goalParams);
        router.push(localizedHref(`/login?email=${encodeURIComponent(value)}&exists=1`, locale));
        return;
      }
      ymGoal("signup_error", { ...goalParams, code: String(res.status) });
      const errorKeys = {
        invalid_email: "invalidEmail",
        consent_required: "consentRequired",
        rate_limited: "rateLimited",
        challenge_rejected: "challengeRejected",
        challenge_unavailable: "challengeUnavailable",
        email_domain_unavailable: "emailDomainUnavailable",
        registration_failed: "registrationFailed",
      } as const;
      const errorCode =
        typeof data.code === "string" && Object.hasOwn(errorKeys, data.code)
          ? (data.code as keyof typeof errorKeys)
          : "registration_failed";
      setError(errorT(errorKeys[errorCode]));
    } catch {
      ymGoal("signup_error", { ...goalParams, code: "network" });
      setError(t("networkError"));
    } finally {
      // После «готово» страница уходит в кабинет — кнопку не возвращаем.
      setStatus((current) => (current === "done" ? current : "idle"));
    }
  }

  return (
    <div className={"w-full " + (align === "start" ? "max-w-[560px]" : "mx-auto max-w-[480px]")}>
      <form
        onSubmit={submit}
        className={
          layout === "stack"
            ? "flex flex-col gap-2.5"
            : "flex flex-col gap-2.5 sm:flex-row sm:gap-2"
        }
      >
        <label htmlFor={inputId} className="sr-only">
          {t("emailLabel")}</label>
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
            onChange={(e) => {
              field.setValue(e.target.value);
              setBlurred(false);
            }}
            onFocus={() => ymGoal("email_field_focus", goalParams)}
            onBlur={() => setBlurred(true)}
            placeholder={t("emailPlaceholder")}
            autoComplete="email"
            inputMode="email"
            aria-invalid={fieldError || typo ? true : undefined}
            aria-describedby={fieldError ? `${inputId}-status` : undefined}
            className={
              // 16px, а не 15: iOS Safari автоматически зумит страницу при
              // фокусе в поле со шрифтом меньше 16px и обратно уже не
              // отъезжает — это и был «непонятный zoom in» на лендинге.
              "h-[56px] w-full rounded-2xl border pl-11 text-[16px] outline-none transition-colors focus:ring-4 sm:h-[60px] " +
              (typo || fieldError ? "pr-[148px] " : "pr-11 ") +
              (dark
                ? "border-white/25 bg-white/10 text-white placeholder:text-white/55 focus:border-white/45 focus:ring-white/10"
                : "border-[#dcdfed] bg-white text-[#0b1024] shadow-[0_1px_2px_rgba(11,16,36,0.05)] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:ring-[#5566f6]/15")
            }
          />
          {typo ? (
            <button
              type="button"
              onClick={() => field.applySuggestion(typo)}
              aria-label={fieldT("applySuggestion", { suggestion: typo })}
              title={fieldT("applySuggestion", { suggestion: typo })}
              className="motion-pop absolute right-2 top-1/2 max-w-[136px] -translate-y-1/2 truncate rounded-xl bg-[#fff4f2] px-2.5 py-1.5 text-[13px] font-medium text-[#a13a32] hover:bg-[#fde3df]"
            >
              {fieldT("short.typoChip", { suggestion: typo })}
            </button>
          ) : fieldError ? (
            <span
              id={`${inputId}-status`}
              role="alert"
              className="motion-pop pointer-events-none absolute right-2 top-1/2 max-w-[136px] -translate-y-1/2 truncate rounded-xl bg-[#fff4f2] px-2.5 py-1.5 text-[13px] font-medium text-[#a13a32]"
            >
              {fieldError}
            </span>
          ) : field.checking ? (
            <Loader2
              aria-label={fieldT("domainChecking")}
              className={"absolute right-4 top-1/2 size-[18px] -translate-y-1/2 animate-spin " + (dark ? "text-white/60" : "text-[#9b9fb3]")}
            />
          ) : fieldOk ? (
            <CheckCircle2 aria-hidden="true" className="motion-pop absolute right-4 top-1/2 size-[18px] -translate-y-1/2 text-[#1f9d55]" />
          ) : null}
        </div>
        <button
          type="submit"
          disabled={loading || !field.valid}
          data-state={status}
          aria-label={status === "loading" ? t("creatingAccount") : undefined}
          className={
            "motion-submit group relative inline-flex h-[56px] shrink-0 items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-2xl px-6 text-[16px] font-semibold [--submit-h:56px] hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 sm:h-[60px] sm:px-7 sm:[--submit-h:60px] " +
            (layout === "stack" ? "w-full self-center " : "max-sm:w-full max-sm:self-center ") +
            (dark
              ? "bg-white text-[#0b1024] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.5)] hover:bg-white/90"
              : "bg-[#5566f6] text-white shadow-[0_20px_50px_-20px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0] hover:shadow-[0_24px_55px_-18px_rgba(85,102,246,0.65)]")
          }
        >
          {/* Подпись остаётся в разметке и держит ширину, пока кнопка
              сжимается в круг: исчезает через размытие, а не вырезается. */}
          <span className="motion-submit-label inline-flex items-center gap-2" aria-hidden={status !== "idle"}>
            {buttonLabel ?? t("startFree")}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </span>
          {status === "done" ? (
            <span key="done" className="absolute inset-0 flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="motion-check motion-pop size-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
          ) : status === "loading" ? (
            <span key="loading" className="absolute inset-0 flex items-center justify-center">
              <span aria-hidden="true" className="motion-spinner block size-5 rounded-full border-[2.5px] border-current border-r-transparent" />
            </span>
          ) : null}
        </button>
      </form>

      {/* Юридический текст согласия — мелкой строкой, как на регистрации:
          формулировку не меняем, это не «основной текст» страницы. */}
      <div data-fine-print="legal">
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
          variant="short"
          confirmLinks
          className="mt-2"
        />
      </div>

      {/* Живой гид по регистрации — тексты гида пока только по-русски. */}
      {showLiveGuide && locale === "ru" ? (
        <LiveGuideStartButton
          className={
            "mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium underline-offset-4 transition-colors hover:underline " +
            (dark ? "text-white/80 hover:text-white" : "text-[#3848c7]")
          }
        >
          <MousePointerClick className="size-4" />
          {t("liveGuide")}
        </LiveGuideStartButton>
      ) : null}

      {challenge.element}

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
        {t("existingAccount")}{" "}
        <Link
          href="/login"
          className={
            "font-medium underline-offset-4 hover:underline " +
            (dark ? "text-white/90" : "text-[#3848c7]")
          }
        >
          {t("signIn")}</Link>
      </div>
    </div>
  );
}
