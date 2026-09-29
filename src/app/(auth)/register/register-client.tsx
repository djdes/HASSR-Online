"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LegalConsentCheckbox } from "@/components/legal/legal-consent-checkbox";
import { BrandLogo } from "@/components/brand/logo";
import { ArrowRight, CheckCircle2, Gift, Loader2, Sparkles, Ticket } from "lucide-react";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { ORG_SPHERES, type OrgSphere } from "@/lib/org-profile";
import { EmailHint, useEmailField } from "@/components/ui/email-field";
import {
  readSignupSource,
  rememberSignupSource,
  ymGoal,
} from "@/lib/signup-source";
import { blankSignupPlace } from "@/lib/blank-download";

/** Те же цели Метрики, что у форм на лендинге, с местом «register». */
const GOAL_PARAMS = { place: "register" };

/**
 * Регистрация в один экран: только почта.
 *
 * Раньше здесь был двухшаговый визард на семь полей плюс код из письма —
 * он и был главным местом, где отваливались люди. Теперь аккаунт
 * создаётся сразу, пароль уходит письмом, а анкета (организация, имя,
 * телефон) заполняется уже внутри кабинета по ненавязчивому баннеру.
 *
 * Страница осталась для прямых заходов и для ссылок «Начать бесплатно»
 * с тарифных карточек — логика ровно та же, что у формы на лендинге.
 */
/** Промокод из ссылки /promo/CODE — уже проверен сервером страницы. */
type RegisterPromo = { code: string; label: string };

export default function RegisterPage({
  promo = null,
  sphere = null,
}: {
  promo?: RegisterPromo | null;
  sphere?: OrgSphere | null;
} = {}) {
  // useSearchParams требует Suspense-границы при статическом рендере.
  return (
    <Suspense fallback={null}>
      <RegisterScreen promo={promo} linkSphere={sphere} />
    </Suspense>
  );
}

function RegisterScreen({
  promo,
  linkSphere,
}: {
  promo: RegisterPromo | null;
  /** Сфера из ссылки с промокодом: подставлена, человек может сменить. */
  linkSphere: OrgSphere | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Почту могли ввести ещё на лендинге. Аккаунт при этом НЕ создаётся:
  // GET-заход только подставляет значение в поле, создание идёт строго
  // по клику — иначе краулеры плодили бы пустые организации.
  const prefilled = (() => {
    const raw = searchParams.get("email")?.trim().toLowerCase() ?? "";
    return raw.includes("@") && raw.length <= 200 ? raw : "";
  })();

  // Куда идти после создания аккаунта (например, на форму партнёрской
  // заявки с /partners). Только внутренний путь — иначе в кабинет.
  const nextPath = (() => {
    const raw = searchParams.get("next") ?? "";
    return raw.startsWith("/") && !raw.startsWith("//") && raw.length <= 500 ? raw : null;
  })();

  // Пришли по QR со скачанного шаблона журнала (/qb): источник «бланк» и
  // код журнала уходят местом формы в уведомление о регистрации, а журнал
  // называем прямо здесь — человек должен понимать, что откроется после.
  const blankSource = searchParams.get("source") === "blank";
  const signupPlace = blankSource ? blankSignupPlace(searchParams.get("journal")) : "register";
  // Журнал каталога, за которым пришли: сервер включит его новой
  // организации, чтобы после регистрации он открылся готовым к заполнению.
  const blankJournal = blankSource
    ? ACTIVE_JOURNAL_CATALOG.find((j) => j.code === searchParams.get("journal")) ?? null
    : null;
  const blankJournalName = blankJournal?.name ?? null;

  const field = useEmailField(prefilled);
  const [sphere, setSphere] = useState<OrgSphere | null>(linkSphere);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [consentMissing, setConsentMissing] = useState(false);

  useEffect(() => {
    rememberSignupSource();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    field.setTouched(true);
    // Кнопка заблокирована при неверном адресе — это страховка на Enter.
    if (!field.valid) return;
    if (!consent) {
      setConsentMissing(true);
      setError("Отметьте согласие с документами — без него аккаунт не создаётся");
      return;
    }
    const value = field.value.trim().toLowerCase();

    setError(null);
    setLoading(true);
    ymGoal("hero_email_submit", GOAL_PARAMS);
    try {
      const res = await fetch("/api/auth/instant-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: value,
          source: readSignupSource(signupPlace),
          consent: true,
          consentPlace: "register",
          ...(blankJournal ? { blankJournal: blankJournal.code } : {}),
          // Сфера из ссылки с промокодом: организация сразу с журналами сферы.
          ...(sphere ? { sphere } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.created) {
        ymGoal("instant_register_done", GOAL_PARAMS);
        ymGoal("signup_created", GOAL_PARAMS);
        router.push(nextPath ?? "/dashboard?welcome=1");
        router.refresh();
        return;
      }
      if (res.ok && data.exists) {
        ymGoal("signup_exists", GOAL_PARAMS);
        router.push(
          `/login?email=${encodeURIComponent(value)}&exists=1${nextPath ? `&next=${encodeURIComponent(nextPath)}` : ""}`,
        );
        return;
      }
      ymGoal("signup_error", { ...GOAL_PARAMS, code: String(res.status) });
      setError(data.error ?? "Не получилось — попробуйте ещё раз");
    } catch {
      ymGoal("signup_error", { ...GOAL_PARAMS, code: "network" });
      setError("Сеть недоступна. Попробуйте ещё раз");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
      {/* Left panel — same brand rhythm as /login */}
      <aside className="relative hidden flex-col overflow-hidden bg-[#0b1024] p-12 text-white lg:flex">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 size-[520px] rounded-full bg-[#5566f6] opacity-40 blur-[120px]" />
          <div className="absolute -bottom-40 -right-32 size-[560px] rounded-full bg-[#7a5cff] opacity-30 blur-[140px]" />
          <div className="absolute left-1/3 top-1/2 size-[340px] rounded-full bg-[#3d4efc] opacity-30 blur-[100px]" />
        </div>
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

        <div className="relative z-10">
          {/* Тот же знак, что в шапке лендинга и в футере — один бренд
              на всех публичных экранах. */}
          <Link href="/" className="text-white" aria-label="WeSetup — на главную">
            <BrandLogo height={26} title="" />
          </Link>
        </div>

        <div className="relative z-10 mt-auto max-w-[520px]">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12px] uppercase tracking-[0.18em] text-white/70 backdrop-blur">
            <Sparkles className="size-3.5 text-[#7cf5c0]" />
            Бесплатно навсегда · без карты
          </div>
          <h1 className="text-[46px] font-semibold leading-[1.05] tracking-[-0.03em]">
            Аккаунт создаётся сразу
          </h1>
          <p className="mt-5 max-w-[440px] text-[16px] leading-[1.6] text-white/70">
            Введите почту — и вы уже в кабинете. Пароль придёт письмом,
            данные организации заполните позже, когда будет удобно.
          </p>

          <div className="mt-10 space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
            <div className="text-[12px] uppercase tracking-[0.2em] text-white/60">
              Что внутри — бесплатно
            </div>
            <ul className="grid grid-cols-1 gap-2 text-[14px] text-white/80">
              {ACTIVE_JOURNAL_CATALOG.slice(0, 6).map((j) => (
                <li key={j.code} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#7cf5c0]" />
                  <span className="truncate">{j.name}</span>
                </li>
              ))}
              <li className="pl-6 text-[13px] text-white/50">
                …и ещё {ACTIVE_JOURNAL_CATALOG.length - 6} журналов СанПиН и
                ХАССП
              </li>
            </ul>
          </div>

          <div className="mt-10 flex items-center gap-4 text-[12px] text-white/50">
            <span>© 2026 WeSetup</span>
            <span className="size-1 rounded-full bg-white/25" />
            <Link
              href="/login"
              className="underline-offset-4 hover:text-white hover:underline"
            >
              Уже есть аккаунт — войти
            </Link>
          </div>
        </div>
      </aside>

      {/* Right panel — one-field form */}
      <main className="relative flex items-center justify-center px-6 py-10 sm:px-10">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage: "radial-gradient(#d9dceb 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />

        <div className="relative w-full max-w-[420px]">
          <div className="mb-8 lg:hidden">
            <Link href="/" className="text-[#0b1024]" aria-label="WeSetup — на главную">
              <BrandLogo height={24} title="" />
            </Link>
          </div>

          {/* Пришли по ссылке «порекомендуй другу». Сам код лежит в
              cookie, здесь только объясняем, что происходит: человек
              должен понимать, почему его пригласили именно так. */}
          {searchParams.get("ref") === "1" ? (
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#dcdfed] bg-[#f5f6ff] px-3 py-1.5 text-[12.5px] font-medium text-[#3848c7]">
              <Gift className="size-3.5" />
              Вас пригласили: 14 дней теста для вас, бонус — другу
            </div>
          ) : null}
          {promo ? (
            <div
              data-testid="register-promo"
              className="mb-4 flex items-start gap-2 rounded-2xl border border-[#c7ccea] bg-[#eef1ff] px-3 py-2 text-[13px] font-medium leading-[1.45] text-[#3848c7]"
            >
              <Ticket className="mt-0.5 size-4 shrink-0" />
              <span>
                {promo.label}. Создайте аккаунт — код подставится на оплате сам.
              </span>
            </div>
          ) : null}
          {blankJournalName ? (
            <div
              data-testid="register-blank-journal"
              className="mb-4 inline-flex items-center gap-2 rounded-2xl border border-[#dcdfed] bg-[#f5f6ff] px-3 py-1.5 text-[12.5px] font-medium leading-[1.4] text-[#3848c7]"
            >
              <CheckCircle2 className="size-3.5 shrink-0" />
              «{blankJournalName}» откроется сразу после регистрации
            </div>
          ) : null}

          <h2 className="text-[clamp(1.5rem,2vw+1rem,2rem)] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
            Начать бесплатно
          </h2>
          <p className="mt-2 text-[14px] leading-[1.6] text-[#6f7282]">
            Достаточно почты. Пароль отправим письмом, войдёте сразу —
            заполнять анкету сейчас не нужно.
          </p>

          <form onSubmit={submit} className="mt-8">
            <label
              htmlFor="register-email"
              className="mb-1.5 block text-[13px] font-medium text-[#0b1024]"
            >
              Электронная почта
            </label>
            <input
              id="register-email"
              type="email"
              value={field.value}
              onChange={(e) => field.setValue(e.target.value)}
              placeholder="you@company.ru"
              autoComplete="email"
              inputMode="email"
              autoFocus={!prefilled}
              required
              // text-[16px]: поле стоит с autoFocus, а iOS Safari при
              // фокусе в поле со шрифтом < 16px зумит страницу — до этой
              // правки регистрация открывалась уже «увеличенной».
              className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[16px] text-[#0b1024] placeholder:text-[#c1c5d6] transition-[border-color,box-shadow] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />

            <EmailHint
              check={field.check}
              touched={field.touched}
              domainState={field.domainState}
              onApply={field.applySuggestion}
            />

            {linkSphere ? (
              <>
                <label
                  htmlFor="register-sphere"
                  className="mb-1.5 mt-4 block text-[13px] font-medium text-[#0b1024]"
                >
                  Сфера
                </label>
                <select
                  id="register-sphere"
                  data-testid="register-sphere"
                  value={sphere ?? linkSphere}
                  onChange={(e) => setSphere(e.target.value as OrgSphere)}
                  className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[16px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                >
                  {ORG_SPHERES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[12px] text-[#6f7282]">
                  По сфере включим нужные журналы — поменять можно и потом.
                </p>
              </>
            ) : null}

            <LegalConsentCheckbox
              checked={consent}
              onChange={(value) => {
                setConsent(value);
                if (value) {
                  setConsentMissing(false);
                  setError(null);
                }
              }}
              highlight={consentMissing}
              className="mt-4"
            />

            {error ? (
              <p className="mt-3 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={loading || !field.valid}
              className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Создаём аккаунт…
                </>
              ) : (
                <>
                  Создать аккаунт
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-[13px] text-[#6f7282]">
            Уже есть аккаунт?{" "}
            <Link
              href="/login"
              className="font-medium text-[#3848c7] underline-offset-4 hover:underline"
            >
              Войти
            </Link>
          </p>


        </div>
      </main>
    </div>
  );
}
