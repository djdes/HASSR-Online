"use client";

import { Children, isValidElement, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Download, Loader2, Mail, MessageSquareText, Phone } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEmailField } from "@/components/ui/email-field";
import {
  BlankDownloadExtras,
  blankExtrasPayload,
  emptyBlankExtrasDraft,
  type BlankExtrasDraft,
} from "@/components/public/blank-download-extras";
import { MaxIcon } from "@/components/max/max-icon";
import { TelegramIcon } from "@/components/public/telegram-icon";
import {
  BLANK_EMAIL_STORAGE_KEY,
  blankFilePath,
  blankLoginHref,
  blankRegisterHref,
  blankSignupPlace,
  normalizeBlankPhone,
  readRememberedBlankEmail,
  type BlankFormat,
  type BlankTarget,
  type RememberedBlankEmail,
} from "@/lib/blank-download";
import type { BlankLayout } from "@/lib/blank-layout";
import { phoneInputProps } from "@/lib/phone-input";
import { TRIAL_DAYS } from "@/lib/tariff-plans";
import { readSignupSource, ymGoal } from "@/lib/signup-source";
import { cn } from "@/lib/utils";
import { downloadFile } from "@/lib/native-bridge";
import { blankDownloadErrorKey } from "@/lib/blank-download-presentation";
import { localizedHref } from "@/i18n/site-locale";

/**
 * Кнопка «Скачать PDF / Word» шаблона журнала на публичных страницах.
 *
 * Первый раз — окно «Куда прислать шаблон?»: почта, телефон (без слова
 * «необязательно» — значки Telegram, MAX, СМС показывают, куда пришлём),
 * название компании, свёрнутое «Дополнительно» (поля под журнал: сотрудники,
 * оборудование, помещения, ответственный — спека
 * blank-download-extras-2026-11), галка согласия на обработку персональных
 * данных и отмеченная по умолчанию галка «Быстрая регистрация» — всего две
 * галки, «Скачать». Сервер записывает согласие и отдаёт подписанную ссылку
 * — файл скачивается сразу, копия уходит письмом.
 * С галкой регистрации сервер заводит кабинет и присылает доступ письмом
 * (спека blank-download-phone-autoreg-2026-11).
 *
 * Невидимая проверка от ботов: скрытое поле-ловушка `website` и время от
 * открытия окна до отправки (`elapsedMs`) — сервер решает по ним сам.
 * Почта запоминается в браузере: следующий шаблон скачивается по одному
 * нажатию (сервер получает ту же почту), а внизу экрана — плашка «копия —
 * на …» с кнопкой сменить почту.
 *
 * `href` у ссылки — адрес файла без токена: без JS (или по средней кнопке
 * мыши) браузер придёт туда, и роут вернёт его на страницу журнала с уже
 * открытым окном — тот же путь, что у старых ссылок из блога и поиска.
 */

export type BlankDownloadClientProps = {
  target: BlankTarget;
  format: BlankFormat;
  /** Название журнала — в окне и в письме. */
  title: string;
  className?: string;
  children?: React.ReactNode;
  /** Открыть сразу: человек пришёл по ссылке на файл (`?download=pdf`). */
  autoOpen?: boolean;
  /** Ссылка из письма устарела — сказать об этом в окне. */
  expired?: boolean;
  /** Без видимой кнопки — только окно (автооткрытие для бумажного бланка). */
  hideTrigger?: boolean;
  /** Где кнопка — параметр целей Метрики. */
  place?: string;
  /** Свой бланк из конструктора: PDF печатается с этими колонками и строками. */
  layout?: BlankLayout | null;
  /** «Вам также пригодятся» после скачивания — связанные журналы (код + название). */
  related?: ReadonlyArray<{ code: string; name: string }>;
};

type Phase = "form" | "sending" | "done";

function readRemembered(): RememberedBlankEmail | null {
  try {
    return readRememberedBlankEmail(window.localStorage.getItem(BLANK_EMAIL_STORAGE_KEY));
  } catch {
    return null;
  }
}

function remember(value: RememberedBlankEmail | null) {
  try {
    if (value) window.localStorage.setItem(BLANK_EMAIL_STORAGE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(BLANK_EMAIL_STORAGE_KEY);
  } catch {
    /* хранилище недоступно — в следующий раз просто спросим почту */
  }
}

/**
 * Скачать по ссылке, не уходя со страницы (ответ — attachment). В
 * приложении WeSetup — файл и лист «Поделиться».
 */
function triggerDownload(url: string) {
  void downloadFile(url, {
    fallback: () => {
      const link = document.createElement("a");
      link.href = url;
      link.download = "";
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
  });
}

/** Кабинет по галке «Быстрая регистрация»: создан, уже был — или галки не было. */
type AccountState = "created" | "exists" | null;

type RequestResult =
  | { ok: true; url: string; consentVersion: string; emailed: boolean; account: AccountState; firstEntryQr: string | null }
  | { ok: false; errorKey: ReturnType<typeof blankDownloadErrorKey>; needConsent: boolean };

/** Что окно передаёт сверх почты: телефон, регистрация, «Дополнительно» и замер для проверки от ботов. */
type FormExtras = {
  phone: string | null;
  register: boolean;
  /** «Дополнительно» — уже без пустых строк (`blankExtrasPayload`), `null` — ничего не вводили. */
  extras: ReturnType<typeof blankExtrasPayload>;
  /** Скрытое поле-ловушка: человек его не видит, у живого — пустое. */
  website: string;
  /** Сколько окно было открыто до отправки, мс. */
  elapsedMs: number;
};

/** Часовой пояс браузера — местное время клиента в уведомлении и в новом кабинете. */
function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

async function requestDownload(params: {
  email: string;
  company?: string;
  target: BlankTarget;
  format: BlankFormat;
  locale: string;
  remembered?: RememberedBlankEmail | null;
  extras?: FormExtras;
  layout?: BlankLayout | null;
}): Promise<RequestResult> {
  const company = (params.company ?? params.remembered?.company ?? "").trim();
  const phone = params.extras?.phone ?? params.remembered?.phone ?? null;
  const journalKey = params.target.kind === "code" ? params.target.code : `paper:${params.target.paperId}`;
  const tz = browserTimeZone();
  // «Дополнительно» и макет из конструктора едут одним полем `extras`.
  const extrasPayload = params.layout
    ? { ...(params.extras?.extras ?? {}), layout: params.layout }
    : (params.extras?.extras ?? null);
  try {
    const res = await fetch("/api/public/blank-download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: params.email,
        ...(company ? { company } : {}),
        ...(params.target.kind === "code" ? { code: params.target.code } : { paperId: params.target.paperId }),
        format: params.format,
        locale: params.locale,
        consent: true,
        ...(tz ? { tz } : {}),
        ...(phone ? { phone } : {}),
        ...(extrasPayload ? { extras: extrasPayload } : {}),
        ...(params.extras
          ? {
              website: params.extras.website,
              elapsedMs: params.extras.elapsedMs,
              ...(params.extras.register ? { register: true, source: readSignupSource(blankSignupPlace(journalKey)) } : {}),
            }
          : {}),
        ...(params.remembered ? { remembered: true, consentVersion: params.remembered.consentVersion, website: "" } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      url?: string;
      consentVersion?: string;
      emailed?: boolean;
      account?: unknown;
      firstEntryQr?: unknown;
      error?: string;
      needConsent?: boolean;
      errorCode?: string;
    };
    if (res.ok && data.url && data.consentVersion) {
      const account: AccountState = data.account === "created" || data.account === "exists" ? data.account : null;
      const firstEntryQr = typeof data.firstEntryQr === "string" && /^https?:\/\//.test(data.firstEntryQr) ? data.firstEntryQr : null;
      return { ok: true, url: data.url, consentVersion: data.consentVersion, emailed: data.emailed !== false, account, firstEntryQr };
    }
    return {
      ok: false,
      errorKey: blankDownloadErrorKey(data.errorCode, Boolean(data.needConsent)),
      needConsent: Boolean(data.needConsent),
    };
  } catch {
    return { ok: false, errorKey: "networkFailure", needConsent: false };
  }
}

export function BlankDownloadClient({
  target,
  format,
  title,
  className,
  children,
  autoOpen = false,
  expired = false,
  hideTrigger = false,
  place = "site",
  layout = null,
  related = [],
}: BlankDownloadClientProps) {
  const t = useTranslations("publicBlankDownload");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [account, setAccount] = useState<AccountState>(null);
  const [firstEntryQr, setFirstEntryQr] = useState<string | null>(null);
  const [error, setError] = useState<ReturnType<typeof blankDownloadErrorKey> | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [showExpired, setShowExpired] = useState(false);
  const [emailed, setEmailed] = useState(true);
  const [notice, setNotice] = useState<{ state: "sending" | "done"; email: string; emailed: boolean } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goal = { place, format };
  const formatLabel = t(`format.${format}`);

  function openForm(
    prefill: string,
    message: ReturnType<typeof blankDownloadErrorKey> | null,
    prefillCompany = "",
    prefillPhone = "",
  ) {
    setEmail(prefill);
    setCompany(prefillCompany);
    setPhone(prefillPhone);
    setError(message);
    setPhase("form");
    setNotice(null);
    setOpen(true);
  }

  async function quickDownload(saved: RememberedBlankEmail) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ state: "sending", email: saved.email, emailed: true });
    const result = await requestDownload({ email: saved.email, company: saved.company, target, format, locale, remembered: saved, layout });
    if (!result.ok) {
      // Редакция документов сменилась или сервер отказал — спрашиваем в окне.
      if (result.needConsent) remember(null);
      openForm(saved.email, result.errorKey, saved.company ?? "", saved.phone ?? "");
      return;
    }
    remember({
      email: saved.email,
      consentVersion: result.consentVersion,
      ...(saved.company ? { company: saved.company } : {}),
      ...(saved.phone ? { phone: saved.phone } : {}),
    });
    triggerDownload(result.url);
    ymGoal("blank_download_done", { ...goal, remembered: "1" });
    setFileUrl(result.url);
    setNotice({ state: "done", email: saved.email, emailed: result.emailed });
    noticeTimer.current = setTimeout(() => setNotice(null), 8000);
  }

  function start(event?: React.MouseEvent) {
    event?.preventDefault();
    ymGoal("blank_download_click", goal);
    const saved = readRemembered();
    if (saved) {
      void quickDownload(saved);
      return;
    }
    openForm("", null);
  }

  // Пришли по старой ссылке на файл: окно (или скачивание по запомненной
  // почте) — сразу; параметры из адреса убираем, чтобы обновление страницы
  // не запускало скачивание ещё раз.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoOpen || autoStarted.current) return;
    autoStarted.current = true;
    setShowExpired(expired);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("download");
      url.searchParams.delete("expired");
      url.searchParams.delete("paper");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch {
      /* адрес оставляем как есть */
    }
    start();
    // start — обычная функция компонента; нужен один запуск при монтировании.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  async function submit(value: string, companyValue: string, extras: FormExtras) {
    const cleanCompany = companyValue.trim();
    setError(null);
    setPhase("sending");
    const result = await requestDownload({
      email: value,
      ...(cleanCompany ? { company: cleanCompany } : {}),
      target,
      format,
      locale,
      extras,
      layout,
    });
    if (!result.ok) {
      setError(result.errorKey);
      setPhase("form");
      return;
    }
    remember({
      email: value,
      consentVersion: result.consentVersion,
      ...(cleanCompany ? { company: cleanCompany } : {}),
      ...(extras.phone ? { phone: extras.phone } : {}),
    });
    triggerDownload(result.url);
    ymGoal("blank_download_done", {
      ...goal,
      ...(extras.phone ? { phone: "1" } : {}),
      ...(extras.extras ? { extras: "1" } : {}),
    });
    if (result.account === "created") ymGoal("blank_quick_register_done", goal);
    setEmail(value);
    setCompany(cleanCompany);
    setPhone(extras.phone ?? "");
    setAccount(result.account);
    setFirstEntryQr(result.firstEntryQr);
    setFileUrl(result.url);
    setEmailed(result.emailed);
    setShowExpired(false);
    setPhase("done");
  }

  function changeEmail() {
    const saved = readRemembered();
    remember(null);
    openForm("", null, saved?.company ?? company, saved?.phone ?? phone);
  }

  return (
    <>
      {hideTrigger ? null : (
        <a
          href={blankFilePath(target, format, locale)}
          onClick={start}
          className={className}
          data-testid={`blank-download-${format}`}
          rel="nofollow"
        >
          {Children.toArray(children).filter((child) => isValidElement(child))}
          <span>{t("trigger.label", { format: formatLabel })}</span>
        </a>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-3xl border-[#ececf4] bg-white p-6 sm:max-w-[460px]" data-testid="blank-download-dialog">
          {phase === "done" ? (
            <DoneView
              title={title}
              email={email}
              emailed={emailed}
              fileUrl={fileUrl}
              account={account}
              firstEntryQr={firstEntryQr}
              related={related}
              registerHref={localizedHref(blankRegisterHref({ email, target }), locale)}
              loginHref={localizedHref(blankLoginHref({ email, target }), locale)}
              onChangeEmail={changeEmail}
            />
          ) : (
            <FormView
              code={target.kind === "code" ? target.code : null}
              title={title}
              formatLabel={formatLabel}
              initialEmail={email}
              initialCompany={company}
              initialPhone={phone}
              error={error}
              expired={showExpired}
              sending={phase === "sending"}
              onSubmit={submit}
            />
          )}
        </DialogContent>
      </Dialog>

      {notice && typeof document !== "undefined"
        ? createPortal(
            <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
              <div
                role="status"
                aria-live="polite"
                data-testid="blank-download-notice"
                className="pointer-events-auto flex max-w-[560px] items-center gap-3 rounded-2xl bg-[#0b1024] px-4 py-3 text-[14px] leading-[1.45] text-white shadow-[0_20px_60px_-20px_rgba(11,16,36,0.6)]"
              >
                {notice.state === "sending" ? (
                  <Loader2 className="size-4 shrink-0 animate-spin text-white/80" />
                ) : (
                  <CheckCircle2 className="size-4 shrink-0 text-[#7cf5c0]" />
                )}
                <span className="min-w-0">
                  {notice.state === "sending"
                    ? t("notice.sending")
                    : t(notice.emailed ? "notice.emailed" : "notice.notEmailed", { title, email: notice.email })}
                </span>
                <button
                  type="button"
                  onClick={changeEmail}
                  className="shrink-0 rounded-xl px-2 py-1 text-[13px] font-medium text-[#b9c1ff] transition-colors duration-150 hover:bg-white/10 hover:text-white"
                >
                  {t("action.changeEmail")}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Поле окна: крупное (52px) и с 16px текстом — иначе iOS Safari зумит страницу при фокусе. */
const FIELD_CLASS =
  "h-[52px] w-full rounded-2xl border border-[#dcdfed] bg-white text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-[border-color,box-shadow] duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const LINK_CLASS = "text-[#3848c7] underline underline-offset-2 transition-colors duration-150 hover:text-[#0b1024]";

function FormView({
  code,
  title,
  formatLabel,
  initialEmail,
  initialCompany = "",
  initialPhone = "",
  error,
  expired,
  sending,
  onSubmit,
}: {
  /** Код журнала каталога — от него зависят поля «Дополнительно»; у бумажного бланка `null`. */
  code: string | null;
  title: string;
  formatLabel: string;
  initialEmail: string;
  initialCompany?: string;
  initialPhone?: string;
  error: ReturnType<typeof blankDownloadErrorKey> | null;
  expired: boolean;
  sending: boolean;
  onSubmit: (email: string, company: string, extras: FormExtras) => void;
}) {
  const t = useTranslations("publicBlankDownload");
  const field = useEmailField(initialEmail);
  const [company, setCompany] = useState(initialCompany);
  const [phone, setPhone] = useState(initialPhone);
  const [phoneInvalid, setPhoneInvalid] = useState(false);
  const [consent, setConsent] = useState(false);
  // Быстрая регистрация — по умолчанию отмечена; снять можно одним нажатием.
  const [register, setRegister] = useState(true);
  // «Дополнительно» свёрнуто: человек, пришедший за файлом, его не видит.
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [extrasDraft, setExtrasDraft] = useState<BlankExtrasDraft>(emptyBlankExtrasDraft);
  // Ошибку адреса показываем, только когда человек ушёл с поля или нажал
  // «Скачать»: подсказки на каждый символ растягивали окно — оно «прыгало».
  const [emailBlurred, setEmailBlurred] = useState(false);
  // Ловушка для ботов: поле скрыто от человека, у живого остаётся пустым.
  const [website, setWebsite] = useState("");
  // Когда окно открылось — время до отправки уходит на сервер. Ленивый
  // начальный state: время берётся один раз, при первом показе формы.
  const [openedAt] = useState(() => Date.now());
  const [consentMissing, setConsentMissing] = useState(false);
  const [localError, setLocalError] = useState<ReturnType<typeof blankDownloadErrorKey> | null>(null);
  const check = field.check;
  const typo = check.status === "typo" ? check.suggestion : null;
  const domainMissing = check.status === "ok" && field.domainState === "missing";
  const emailProblem = check.status !== "ok" || domainMissing;
  const showEmailError = emailBlurred && field.value.trim() !== "" && emailProblem && !typo;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    field.setTouched(true);
    setEmailBlurred(true);
    if (!field.valid) return;
    const cleanPhone = normalizeBlankPhone(phone);
    if (cleanPhone === undefined) {
      setPhoneInvalid(true);
      return;
    }
    if (!consent) {
      setConsentMissing(true);
      setLocalError("consentRequired");
      return;
    }
    setLocalError(null);
    onSubmit(field.value.trim().toLowerCase(), company, {
      phone: cleanPhone,
      register,
      extras: blankExtrasPayload(extrasDraft, code),
      website,
      elapsedMs: Math.max(0, Date.now() - openedAt),
    });
  }

  const shownError = localError ?? error;

  return (
    <>
      <DialogHeader className="text-left">
        <DialogTitle className="text-[20px] font-semibold tracking-[-0.01em] text-[#0b1024]">
          {t("dialog.title")}
        </DialogTitle>
        <DialogDescription className="text-[14px] leading-[1.55] text-[#6f7282]">
          {t("dialog.description", { title, format: formatLabel })}
        </DialogDescription>
      </DialogHeader>

      {expired ? (
        <p className="rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] leading-[1.5] text-[#a13a32]">
          {t("dialog.expired")}
        </p>
      ) : null}

      <form onSubmit={submit} noValidate>
        <div className="space-y-3">
          <div>
            <div className="relative">
              <Mail
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-[#9b9fb3]"
              />
              <input
                id="blank-download-email"
                type="email"
                value={field.value}
                onChange={(event) => field.setValue(event.target.value)}
                onBlur={() => setEmailBlurred(true)}
                placeholder={t("email.label")}
                aria-label={t("email.label")}
                aria-invalid={showEmailError || Boolean(typo) || undefined}
                aria-describedby={showEmailError ? "blank-download-email-error" : undefined}
                autoComplete="email"
                inputMode="email"
                autoFocus
                className={cn(
                  FIELD_CLASS,
                  "pl-11",
                  typo ? "pr-[132px]" : "pr-11",
                  (showEmailError || typo) && "border-[#e4877d] focus:border-[#d2584b] focus:ring-[#d2584b]/15",
                )}
              />
              {/* Подсказки — внутри поля справа: окно не меняет высоту, пока
                  человек печатает. */}
              {typo ? (
                <button
                  type="button"
                  onClick={() => field.applySuggestion(typo)}
                  aria-label={t("email.typoFix", { suggestion: typo })}
                  title={t("email.typoFix", { suggestion: typo })}
                  data-testid="blank-download-email-typo"
                  className="absolute right-2 top-1/2 max-w-[124px] -translate-y-1/2 truncate rounded-xl bg-[#fff4f2] px-2.5 py-1.5 text-[13px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#fde3df]"
                >
                  {t("email.typoChip", { suggestion: typo })}
                </button>
              ) : field.checking ? (
                <Loader2
                  aria-label={t("email.checking")}
                  className="absolute right-4 top-1/2 size-[18px] -translate-y-1/2 animate-spin text-[#9b9fb3]"
                />
              ) : check.status === "ok" && field.domainState === "ok" ? (
                <CheckCircle2 aria-hidden="true" className="absolute right-4 top-1/2 size-[18px] -translate-y-1/2 text-[#1f9d55]" />
              ) : null}
            </div>
            {showEmailError ? (
              <p id="blank-download-email-error" role="alert" className="mt-1.5 truncate px-1 text-[13px] leading-[1.4] text-[#a13a32]">
                {t(domainMissing ? "email.domainMissing" : "email.invalid")}
              </p>
            ) : null}
          </div>

          {/* Телефон: без слова «необязательно» — значки справа показывают,
              куда пришлём шаблон. Полная фраза — для экранных чтецов. */}
          <div className="relative">
            <Phone
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-[#9b9fb3]"
            />
            <input
              id="blank-download-phone"
              data-testid="blank-download-phone"
              type="tel"
              maxLength={24}
              placeholder={t("phone.label")}
              aria-label={t("phone.label")}
              aria-describedby="blank-download-phone-channels"
              aria-invalid={phoneInvalid || undefined}
              {...phoneInputProps(phone, (next) => {
                setPhone(next);
                if (phoneInvalid) setPhoneInvalid(false);
              })}
              className={cn(
                FIELD_CLASS,
                "pl-11 pr-[104px] tabular-nums",
                phoneInvalid && "border-[#e4877d] focus:border-[#d2584b] focus:ring-[#d2584b]/15",
              )}
            />
            <span
              id="blank-download-phone-channels"
              title={t("phone.channels")}
              className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5"
            >
              <span className="sr-only">{t("phone.channels")}</span>
              <TelegramIcon className="size-[22px]" />
              <MaxIcon className="size-[22px]" />
              <span className="flex size-[22px] items-center justify-center rounded-full bg-[#eef1f7] text-[#5f6170]">
                <MessageSquareText aria-hidden="true" className="size-[13px]" />
              </span>
            </span>
          </div>
          {phoneInvalid ? (
            <p role="alert" className="text-[13px] leading-[1.5] text-[#a13a32]">
              {t("phone.invalid")}
            </p>
          ) : null}

          <input
            id="blank-download-company"
            data-testid="blank-download-company"
            type="text"
            maxLength={160}
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            placeholder={t("company.placeholder")}
            aria-label={t("company.placeholder")}
            autoComplete="organization"
            className={cn(FIELD_CLASS, "px-4")}
          />
        </div>

        <div className="mt-1.5">
          <BlankDownloadExtras
            code={code}
            open={extrasOpen}
            onToggle={() => setExtrasOpen((value) => !value)}
            draft={extrasDraft}
            onChange={setExtrasDraft}
          />
        </div>

        <div aria-hidden="true" className="hidden">
          <label htmlFor="blank-download-website">{t("form.websiteLabel")}</label>
          <input
            id="blank-download-website"
            name="website"
            type="text"
            autoComplete="off"
            tabIndex={-1}
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </div>

        <label
          className={cn(
            "mt-3 flex cursor-pointer items-start gap-3 rounded-2xl px-1 py-1.5 text-left text-[13px] leading-[1.5] text-[#6f7282] transition-colors duration-150",
            consentMissing && !consent && "bg-[#fff4f2] ring-2 ring-[#f2b8b0]",
          )}
          data-testid="blank-download-consent-label"
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => {
              setConsent(event.target.checked);
              if (event.target.checked) {
                setConsentMissing(false);
                setLocalError(null);
              }
            }}
            className="mt-px size-5 shrink-0 accent-[#5566f6]"
            data-testid="blank-download-consent"
          />
          <span>
            {t.rich("consent.statement", {
              consent: (chunks) => <Link href="/consent" target="_blank" className={LINK_CLASS}>{chunks}</Link>,
              privacy: (chunks) => <Link href="/privacy" target="_blank" className={LINK_CLASS}>{chunks}</Link>,
            })}
          </span>
        </label>

        <label className="mt-0.5 flex cursor-pointer items-start gap-3 rounded-2xl px-1 py-1.5 text-left text-[13px] leading-[1.5] text-[#6f7282]">
          <input
            type="checkbox"
            checked={register}
            onChange={(event) => setRegister(event.target.checked)}
            className="mt-px size-5 shrink-0 accent-[#5566f6]"
            data-testid="blank-download-register"
          />
          <span>
            <span className="block text-[14px] text-[#0b1024]">
              {t.rich("register.statement", {
                lead: (chunks) => <span className="font-medium">{chunks}</span>,
                trialDays: TRIAL_DAYS,
              })}
            </span>
            <span className="block text-[12px]">
              {t.rich("register.terms", {
                offer: (chunks) => <Link href="/oferta" target="_blank" className={LINK_CLASS}>{chunks}</Link>,
                terms: (chunks) => <Link href="/terms" target="_blank" className={LINK_CLASS}>{chunks}</Link>,
              })}
            </span>
          </span>
        </label>

        {shownError ? (
          <p role="alert" className="mt-3 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] leading-[1.5] text-[#a13a32]">
            {t(`error.${shownError}`)}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={sending || !field.valid}
          data-testid="blank-download-submit"
          className="mt-5 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[16px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t("form.sending")}
            </>
          ) : (
            <>
              <Download className="size-[18px]" />
              {t("form.submit", { format: formatLabel })}
            </>
          )}
        </button>
      </form>
    </>
  );
}

function DoneView({
  title,
  email,
  emailed,
  fileUrl,
  account,
  firstEntryQr = null,
  related = [],
  registerHref,
  loginHref,
  onChangeEmail,
}: {
  title: string;
  email: string;
  emailed: boolean;
  fileUrl: string | null;
  account: AccountState;
  firstEntryQr?: string | null;
  related?: ReadonlyArray<{ code: string; name: string }>;
  registerHref: string;
  loginHref: string;
  onChangeEmail: () => void;
}) {
  const t = useTranslations("publicBlankDownload");
  const strong = (chunks: React.ReactNode) => <span className="font-medium text-[#0b1024]">{chunks}</span>;
  return (
    <>
      <DialogHeader className="text-left">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-[#ecfdf5] text-[#116b2a]"><CheckCircle2 className="size-5" /></span>
        <DialogTitle className="text-[20px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("done.heading")}</DialogTitle>
        <DialogDescription className="text-[14px] leading-[1.55] text-[#6f7282]">
          {t.rich(emailed ? "done.emailed" : "done.notEmailed", {
            email: strong,
            address: email,
          })}
          {fileUrl ? <> {t("done.downloadHelp")} <a href={fileUrl} download className="font-medium text-[#3848c7] underline-offset-4 hover:underline">{t("done.downloadAgain")}</a></> : null}
        </DialogDescription>
      </DialogHeader>
      {account === "created" ? (
        <div className="rounded-2xl border border-[#5566f6]/20 bg-gradient-to-br from-[#f5f6ff] to-white p-4" data-testid="blank-download-account">
          <div className="text-[15px] font-semibold text-[#0b1024]">{t("done.accountCreatedTitle")}</div>
          <p className="mt-1 text-[14px] leading-[1.55] text-[#3c4053]">
            {t.rich("done.accountCreatedBody", { email: strong, address: email })}
          </p>
          {firstEntryQr ? <FirstEntryQr url={firstEntryQr} /> : null}
        </div>
      ) : account === "exists" ? (
        <div className="rounded-2xl border border-[#5566f6]/20 bg-gradient-to-br from-[#f5f6ff] to-white p-4" data-testid="blank-download-account">
          <div className="text-[15px] font-semibold text-[#0b1024]">{t("done.accountExistsTitle")}</div>
          <p className="mt-1 text-[14px] leading-[1.55] text-[#3c4053]">{t("done.accountExistsBody", { title })}</p>
          <Link href={loginHref} className="mt-3 inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0]">
            {t("done.signIn")}<ArrowRight className="size-4" />
          </Link>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#5566f6]/20 bg-gradient-to-br from-[#f5f6ff] to-white p-4">
          <div className="text-[14px] font-semibold text-[#0b1024]">{t("done.paperlessTitle", { title })}</div>
          <p className="mt-1 text-[13px] leading-[1.55] text-[#3c4053]">{t("done.paperlessBody")}</p>
          <Link href={registerHref} className="mt-3 inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0]">
            {t("done.paperlessAction")}<ArrowRight className="size-4" />
          </Link>
        </div>
      )}
      {related.length ? <RelatedJournals items={related} /> : null}
      <p className="text-center text-[13px] text-[#6f7282]">{t("done.emailWrong")} <button type="button" onClick={onChangeEmail} className="font-medium text-[#3848c7] underline-offset-4 hover:underline">{t("action.changeEmail")}</button></p>
    </>
  );
}

/**
 * После быстрой регистрации — QR журнала в новом кабинете: навёл телефон и
 * сделал первую запись, пока окно ещё открыто (спека
 * journal-page-engagement-2026-11). Картинка рисуется в браузере.
 */
function FirstEntryQr({ url }: { url: string }) {
  const t = useTranslations("publicBlankDownload");
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void import("qrcode")
      .then((QRCode) => QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" }))
      .then((data) => {
        if (alive) setImage(data);
      })
      .catch(() => {
        /* без картинки остаётся ссылка */
      });
    return () => {
      alive = false;
    };
  }, [url]);
  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#ececf4] bg-white p-3" data-testid="blank-download-first-entry">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- data: URL, рисуется в браузере
        <img src={image} alt="" width={96} height={96} className="size-24 shrink-0 rounded-lg" />
      ) : (
        <span className="size-24 shrink-0 animate-pulse rounded-lg bg-[#f5f6ff]" />
      )}
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-[#0b1024]">{t("done.firstEntryTitle")}</div>
        <p className="mt-0.5 text-[13px] leading-[1.5] text-[#3c4053]">{t("done.firstEntryBody")}</p>
        <a href={url} target="_blank" rel="noopener" className="mt-1 inline-block text-[13px] font-medium text-[#3848c7] underline-offset-4 hover:underline">
          {t("done.firstEntryLink")}
        </a>
      </div>
    </div>
  );
}

/**
 * «Вам также пригодятся» — 3 журнала той же группы (спека
 * seo-speed-pack-2026-11, п. 20): человек скачал один бланк — показываем,
 * что ещё обычно ведут рядом, вместо тупика после скачивания.
 */
function RelatedJournals({ items }: { items: ReadonlyArray<{ code: string; name: string }> }) {
  const t = useTranslations("publicBlankDownload");
  const locale = useLocale();
  return (
    <div data-testid="blank-download-related">
      <div className="text-[13px] font-semibold text-[#0b1024]">{t("done.alsoUseful")}</div>
      <ul className="mt-2 space-y-1.5">
        {items.slice(0, 3).map((item) => (
          <li key={item.code}>
            <Link
              href={localizedHref(`/journals-info/${item.code}`, locale)}
              className="flex items-center justify-between gap-2 rounded-xl border border-[#ececf4] px-3 py-2 text-[14px] text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <span className="min-w-0 truncate">{item.name}</span>
              <ArrowRight className="size-4 shrink-0 text-[#9b9fb3]" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
