"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Download, Loader2, Mail } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmailHint, useEmailField } from "@/components/ui/email-field";
import {
  BLANK_CONSENT_PARTS,
  BLANK_EMAIL_STORAGE_KEY,
  BLANK_FORMAT_LABEL,
  BLANK_MARKETING_CONSENT_LABEL,
  BLANK_MARKETING_CONSENT_NOTE,
  blankFilePath,
  blankRegisterHref,
  readRememberedBlankEmail,
  type BlankFormat,
  type BlankTarget,
  type RememberedBlankEmail,
} from "@/lib/blank-download";
import { ymGoal } from "@/lib/signup-source";
import { cn } from "@/lib/utils";
import { downloadFile } from "@/lib/native-bridge";

/**
 * Кнопка «Скачать PDF / Word» шаблона журнала на публичных страницах.
 *
 * Первый раз — окно «Куда прислать шаблон?»: почта, галка согласия на
 * обработку персональных данных, необязательная (снятая) галка «Присылать
 * полезные материалы и новости», «Скачать». Сервер записывает согласие
 * (и согласие на письма, если отмечено) и отдаёт подписанную ссылку —
 * файл скачивается сразу, копия уходит письмом.
 * Почта запоминается в браузере: следующий шаблон скачивается по одному
 * нажатию (сервер получает ту же почту), а внизу экрана — плашка «копия —
 * на …» с кнопкой сменить почту.
 *
 * `href` у ссылки — адрес файла без токена: без JS (или по средней кнопке
 * мыши) браузер придёт туда, и роут вернёт его на страницу журнала с уже
 * открытым окном — тот же путь, что у старых ссылок из блога и поиска.
 */

type Props = {
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

type RequestResult =
  | { ok: true; url: string; consentVersion: string; emailed: boolean }
  | { ok: false; error: string; needConsent: boolean };

async function requestDownload(params: {
  email: string;
  target: BlankTarget;
  format: BlankFormat;
  remembered?: RememberedBlankEmail | null;
  /** Отмечена галка «Присылать полезные материалы и новости». */
  marketing?: boolean;
}): Promise<RequestResult> {
  try {
    const res = await fetch("/api/public/blank-download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: params.email,
        ...(params.target.kind === "code" ? { code: params.target.code } : { paperId: params.target.paperId }),
        format: params.format,
        consent: true,
        ...(params.marketing ? { marketing: true } : {}),
        ...(params.remembered ? { remembered: true, consentVersion: params.remembered.consentVersion } : {}),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      url?: string;
      consentVersion?: string;
      emailed?: boolean;
      error?: string;
      needConsent?: boolean;
    };
    if (res.ok && data.url && data.consentVersion) {
      return { ok: true, url: data.url, consentVersion: data.consentVersion, emailed: data.emailed !== false };
    }
    return {
      ok: false,
      error: data.error ?? "Не получилось подготовить шаблон. Попробуйте ещё раз",
      needConsent: Boolean(data.needConsent),
    };
  } catch {
    return { ok: false, error: "Сеть недоступна. Попробуйте ещё раз", needConsent: false };
  }
}

export function BlankDownloadButton({
  target,
  format,
  title,
  className,
  children,
  autoOpen = false,
  expired = false,
  hideTrigger = false,
  place = "site",
}: Props) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [showExpired, setShowExpired] = useState(false);
  const [emailed, setEmailed] = useState(true);
  const [notice, setNotice] = useState<{ state: "sending" | "done"; email: string; emailed: boolean } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const goal = { place, format };
  const formatLabel = BLANK_FORMAT_LABEL[format];

  function openForm(prefill: string, message: string | null) {
    setEmail(prefill);
    setError(message);
    setPhase("form");
    setNotice(null);
    setOpen(true);
  }

  async function quickDownload(saved: RememberedBlankEmail) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ state: "sending", email: saved.email, emailed: true });
    const result = await requestDownload({ email: saved.email, target, format, remembered: saved });
    if (!result.ok) {
      // Редакция документов сменилась или сервер отказал — спрашиваем в окне.
      if (result.needConsent) remember(null);
      openForm(saved.email, result.error);
      return;
    }
    remember({ email: saved.email, consentVersion: result.consentVersion });
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

  async function submit(value: string, marketing: boolean) {
    setError(null);
    setPhase("sending");
    const result = await requestDownload({ email: value, target, format, marketing });
    if (!result.ok) {
      setError(result.error);
      setPhase("form");
      return;
    }
    remember({ email: value, consentVersion: result.consentVersion });
    triggerDownload(result.url);
    ymGoal("blank_download_done", marketing ? { ...goal, marketing: "1" } : goal);
    setEmail(value);
    setFileUrl(result.url);
    setEmailed(result.emailed);
    setShowExpired(false);
    setPhase("done");
  }

  function changeEmail() {
    remember(null);
    openForm("", null);
  }

  return (
    <>
      {hideTrigger ? null : (
        <a
          href={blankFilePath(target, format)}
          onClick={start}
          className={className}
          data-testid={`blank-download-${format}`}
          rel="nofollow"
        >
          {children}
        </a>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl border-[#ececf4] bg-white p-6 sm:max-w-[440px]" data-testid="blank-download-dialog">
          {phase === "done" ? (
            <DoneView
              title={title}
              email={email}
              emailed={emailed}
              fileUrl={fileUrl}
              registerHref={blankRegisterHref({ email, target })}
              onChangeEmail={changeEmail}
            />
          ) : (
            <FormView
              title={title}
              formatLabel={formatLabel}
              initialEmail={email}
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
                  {notice.state === "sending" ? "Готовим шаблон…" : `«${title}» скачивается.`}{" "}
                  <span className="text-white/70">
                    {notice.emailed ? `Копия — на ${notice.email}.` : `Почта: ${notice.email}.`}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={changeEmail}
                  className="shrink-0 rounded-xl px-2 py-1 text-[13px] font-medium text-[#b9c1ff] transition-colors duration-150 hover:bg-white/10 hover:text-white"
                >
                  Другая почта
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function FormView({
  title,
  formatLabel,
  initialEmail,
  error,
  expired,
  sending,
  onSubmit,
}: {
  title: string;
  formatLabel: string;
  initialEmail: string;
  error: string | null;
  expired: boolean;
  sending: boolean;
  onSubmit: (email: string, marketing: boolean) => void;
}) {
  const field = useEmailField(initialEmail);
  const [consent, setConsent] = useState(false);
  // Согласие на письма — необязательное и по умолчанию снято: на
  // скачивание не влияет (спека landing-pack-2026-09).
  const [marketing, setMarketing] = useState(false);
  const [consentMissing, setConsentMissing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const domainMissing = field.check.status === "ok" && field.domainState === "missing";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    field.setTouched(true);
    if (!field.valid) return;
    if (!consent) {
      setConsentMissing(true);
      setLocalError("Отметьте согласие — без него шаблон не отправить");
      return;
    }
    setLocalError(null);
    onSubmit(field.value.trim().toLowerCase(), marketing);
  }

  const shownError = localError ?? error;

  return (
    <>
      <DialogHeader className="text-left">
        <DialogTitle className="text-[20px] font-semibold tracking-[-0.01em] text-[#0b1024]">
          Куда прислать шаблон?
        </DialogTitle>
        <DialogDescription className="text-[14px] leading-[1.55] text-[#6f7282]">
          «{title}», {formatLabel}. Файл скачается сразу, а копия со ссылкой придёт на почту.
        </DialogDescription>
      </DialogHeader>

      {expired ? (
        <p className="rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] leading-[1.5] text-[#a13a32]">
          Ссылка из письма устарела — скачайте шаблон заново.
        </p>
      ) : null}

      <form onSubmit={submit} noValidate>
        <label htmlFor="blank-download-email" className="mb-1.5 block text-[13px] font-medium text-[#0b1024]">
          Электронная почта
        </label>
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
            placeholder="you@company.ru"
            autoComplete="email"
            inputMode="email"
            autoFocus
            // 16px: иначе iOS Safari зумит страницу при фокусе в поле.
            className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white pl-11 pr-4 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-[border-color,box-shadow] duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        {domainMissing ? (
          <p className="mt-2.5 text-[13px] leading-[1.5] text-[#a13a32]">
            Такого домена не существует — проверьте адрес. Письмо на него не дойдёт.
          </p>
        ) : (
          <EmailHint
            check={field.check}
            touched={field.touched}
            domainState={field.domainState}
            onApply={field.applySuggestion}
          />
        )}

        <label
          className={cn(
            "mt-4 flex cursor-pointer items-start gap-2.5 rounded-2xl px-1 py-1 text-left text-[12.5px] leading-[1.5] text-[#6f7282] transition-colors duration-150",
            consentMissing && !consent && "bg-[#fff4f2] ring-2 ring-[#f2b8b0]",
          )}
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
            className="mt-0.5 size-[18px] shrink-0 accent-[#5566f6]"
            data-testid="blank-download-consent"
          />
          <span>
            {BLANK_CONSENT_PARTS.map((part) =>
              "href" in part ? (
                <Link
                  key={part.text}
                  href={part.href}
                  target="_blank"
                  className="text-[#3848c7] underline underline-offset-2 transition-colors duration-150 hover:text-[#0b1024]"
                >
                  {part.text}
                </Link>
              ) : (
                <span key={part.text}>{part.text}</span>
              ),
            )}
          </span>
        </label>

        <label className="mt-1 flex cursor-pointer items-start gap-2.5 rounded-2xl px-1 py-1 text-left text-[12.5px] leading-[1.5] text-[#6f7282]">
          <input
            type="checkbox"
            checked={marketing}
            onChange={(event) => setMarketing(event.target.checked)}
            className="mt-0.5 size-[18px] shrink-0 accent-[#5566f6]"
            data-testid="blank-download-marketing"
          />
          <span>
            <span className="text-[#3c4053]">{BLANK_MARKETING_CONSENT_LABEL}</span>
            <span className="block">{BLANK_MARKETING_CONSENT_NOTE}.</span>
          </span>
        </label>

        {shownError ? (
          <p role="alert" className="mt-3 rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] leading-[1.5] text-[#a13a32]">
            {shownError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={sending || !field.valid}
          data-testid="blank-download-submit"
          className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Готовим шаблон…
            </>
          ) : (
            <>
              <Download className="size-4" />
              Скачать {formatLabel}
            </>
          )}
        </button>
        <p className="mt-3 text-center text-[12px] text-[#9b9fb3]">Регистрация не нужна.</p>
      </form>
    </>
  );
}

function DoneView({
  title,
  email,
  emailed,
  fileUrl,
  registerHref,
  onChangeEmail,
}: {
  title: string;
  email: string;
  /** Письмо со ссылками ушло (не упёрлись в лимит писем на почту). */
  emailed: boolean;
  fileUrl: string | null;
  registerHref: string;
  onChangeEmail: () => void;
}) {
  return (
    <>
      <DialogHeader className="text-left">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-[#ecfdf5] text-[#116b2a]">
          <CheckCircle2 className="size-5" />
        </span>
        <DialogTitle className="text-[20px] font-semibold tracking-[-0.01em] text-[#0b1024]">
          Шаблон скачивается
        </DialogTitle>
        <DialogDescription className="text-[14px] leading-[1.55] text-[#6f7282]">
          {emailed ? (
            <>
              Копию со ссылкой отправили на <span className="font-medium text-[#0b1024]">{email}</span> — она
              работает 7 дней.
            </>
          ) : (
            <>
              На <span className="font-medium text-[#0b1024]">{email}</span> сегодня уже ушло много писем — эту
              копию не отправляли, ссылка ниже работает 7 дней.
            </>
          )}
          {fileUrl ? (
            <>
              {" "}
              Загрузка не началась?{" "}
              <a href={fileUrl} download className="font-medium text-[#3848c7] underline-offset-4 hover:underline">
                Скачать ещё раз
              </a>
            </>
          ) : null}
        </DialogDescription>
      </DialogHeader>

      <div className="rounded-2xl border border-[#5566f6]/20 bg-gradient-to-br from-[#f5f6ff] to-white p-4">
        <div className="text-[14px] font-semibold text-[#0b1024]">«{title}» можно не печатать</div>
        <p className="mt-1 text-[13px] leading-[1.55] text-[#3c4053]">
          В WeSetup журнал заполняют с телефона по QR — тому же, что на шаблоне. С напоминаниями, если смена
          забыла отметиться.
        </p>
        <Link
          href={registerHref}
          className="mt-3 inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0]"
        >
          Вести с телефона бесплатно
          <ArrowRight className="size-4" />
        </Link>
      </div>

      <p className="text-center text-[13px] text-[#6f7282]">
        Не та почта?{" "}
        <button
          type="button"
          onClick={onChangeEmail}
          className="font-medium text-[#3848c7] underline-offset-4 hover:underline"
        >
          Указать другую
        </button>
      </p>
    </>
  );
}
