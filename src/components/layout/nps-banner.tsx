"use client";

import { X } from "lucide-react";
import { useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { toast } from "sonner";

import { checkEmail, replaceDomain } from "@/lib/email-validation";
import {
  NPS_COMMENT_MAX_LENGTH,
  NPS_CURRENT_SCALE,
  NPS_RECOMMEND_DEFAULT_MESSAGE,
  NPS_RECOMMEND_MESSAGE_MAX_LENGTH,
  npsInvitesRecommendation,
} from "@/lib/nps";

const SCORES = [1, 2, 3, 4, 5] as const;

type Phase = "ask" | "answered" | "done" | "hidden";
type FormError = { field: "email" | "message" | "comment" | "form"; text: string } | null;

async function requestJson(url: string, method: "POST" | "PATCH", body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, data };
}

function errorText(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" && data.error ? data.error : fallback;
}

/**
 * Опрос «Посоветуете WeSetup коллегам?»: шкала 1–5 в одну строку, оценка
 * сохраняется сразу по клику. 4–5 — тут же письмо коллеге (почта +
 * сообщение с текстом по умолчанию), 1–3 — «Что улучшить?». Закрыть можно
 * в любой момент: оценка уже записана. Когда показывать, решает сервер
 * (lib/nps-data.ts) — флагом `ask`.
 *
 * `ask` может смениться на false прямо во время ответа: оценка ставит
 * `npsAskedAt`, а дашборд перечитывает серверную часть по живым событиям
 * (`router.refresh()`). Начатый ответ при этом не пропадает — блок
 * держится, пока человек не отправит письмо, отзыв или не закроет его.
 */
export function NpsBanner({ variant = "site", ask = true }: { variant?: "site" | "mini"; ask?: boolean }) {
  const [phase, setPhase] = useState<Phase>("ask");
  const [score, setScore] = useState<number | null>(null);
  const [doneText, setDoneText] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [message, setMessage] = useState(NPS_RECOMMEND_DEFAULT_MESSAGE);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<FormError>(null);
  const [busy, setBusy] = useState(false);
  const responseId = useRef<string | null>(null);
  // Сохранения оценки идут строго по очереди: второй клик, пока первый
  // запрос в пути, правит тот же ответ, а не создаёт второй.
  const saving = useRef<Promise<void>>(Promise.resolve());
  const ids = useId();

  function saveScore(value: number): Promise<void> {
    const run = async () => {
      const id = responseId.current;
      const { ok, data } = id
        ? await requestJson("/api/nps", "PATCH", { id, score: value })
        : await requestJson("/api/nps", "POST", { score: value, scale: NPS_CURRENT_SCALE });
      if (!ok) throw new Error(errorText(data, "Не удалось сохранить оценку"));
      if (!id && typeof data.id === "string") responseId.current = data.id;
    };
    const next = saving.current.then(run);
    saving.current = next.catch(() => undefined);
    return next;
  }

  function pick(value: number) {
    setScore(value);
    setPhase("answered");
    setError(null);
    saveScore(value).catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить оценку");
      if (!responseId.current) {
        setScore(null);
        setPhase("ask");
      }
    });
  }

  async function savedResponseId(): Promise<string | null> {
    await saving.current;
    return responseId.current;
  }

  function finish(text: string) {
    setDoneText(text);
    setPhase("done");
    toast.success(text);
    window.setTimeout(() => setPhase("hidden"), 2500);
  }

  async function sendRecommendation(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const check = checkEmail(email);
    if (check.status === "empty") return setError({ field: "email", text: "Укажите почту коллеги" });
    if (check.status === "invalid") return setError({ field: "email", text: check.message });
    setBusy(true);
    setError(null);
    try {
      const id = await savedResponseId();
      if (!id) return setError({ field: "form", text: "Оценка не сохранилась — выберите её ещё раз" });
      const { ok, data } = await requestJson("/api/nps/recommend", "POST", { responseId: id, email: email.trim(), message });
      if (!ok) {
        const field = data.field === "email" || data.field === "message" ? data.field : "form";
        return setError({ field, text: errorText(data, "Не удалось отправить письмо") });
      }
      finish("Спасибо! Письмо отправлено");
    } catch {
      setError({ field: "form", text: "Нет связи — попробуйте ещё раз" });
    } finally {
      setBusy(false);
    }
  }

  async function sendComment(event: FormEvent) {
    event.preventDefault();
    const text = comment.trim();
    if (busy || !text) return;
    setBusy(true);
    setError(null);
    try {
      const id = await savedResponseId();
      if (!id) return setError({ field: "form", text: "Оценка не сохранилась — выберите её ещё раз" });
      const { ok, data } = await requestJson("/api/nps", "PATCH", { id, comment: text });
      if (!ok) return setError({ field: "comment", text: errorText(data, "Не удалось отправить") });
      finish("Спасибо! Учтём");
    } catch {
      setError({ field: "form", text: "Нет связи — попробуйте ещё раз" });
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setPhase("hidden");
    // Оценку уже поставили — она сохранена, «не сейчас» слать незачем.
    if (score === null) void requestJson("/api/nps", "POST", { dismiss: true }).catch(() => null);
  }

  if (phase === "hidden") return null;
  if (!ask && phase === "ask" && score === null) return null;

  const mini = variant === "mini";
  const recommend = score !== null && npsInvitesRecommendation(score, NPS_CURRENT_SCALE);
  const shell = mini
    ? "mb-4 rounded-2xl border px-4 py-3.5"
    : "mb-5 rounded-3xl border border-[#ececf4] bg-white px-5 py-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";
  const shellStyle: CSSProperties | undefined = mini
    ? { background: "var(--mini-card-solid-bg)", borderColor: "var(--mini-divider)", color: "var(--mini-text)" }
    : undefined;
  // Цвета второго плана: на сайте — токены дизайн-системы, в Mini App —
  // переменные темы (светлая и тёмная).
  const tone = (site: string, miniVar: string): { className?: string; style?: CSSProperties } =>
    mini ? { style: { color: `var(${miniVar})` } } : { className: site };
  const muted = tone("text-[#6f7282]", "--mini-text-muted");
  const faint = tone("text-[#9b9fb3]", "--mini-text-faint");
  const danger = tone("text-[#a13a32]", "--mini-crimson");
  const success = tone("text-[#116b2a]", "--mini-sage");
  const field = mini
    ? "mini-input w-full"
    : "w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
  const label = mini ? "text-[13px] font-medium" : "text-[13px] font-medium text-[#3c4053]";
  const submit =
    "inline-flex h-11 w-full items-center justify-center rounded-2xl bg-[#5566f6] px-6 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto";
  const emailCheck = checkEmail(email);
  const emailSuggestion = emailTouched && emailCheck.status === "typo" ? emailCheck : null;

  const fieldError = (name: "email" | "message" | "comment" | "form") =>
    error?.field === name ? (
      <p id={`${ids}-${name}-error`} role="alert" className={`mt-1.5 text-[13px] leading-[1.5] ${danger.className ?? ""}`} style={danger.style}>
        {error.text}
      </p>
    ) : null;

  return (
    <div className={shell} style={shellStyle} data-testid="nps-banner" role="region" aria-label="Опрос: посоветуете ли WeSetup коллегам">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 sm:flex sm:items-start sm:gap-6">
          <div className="pt-1.5 text-[16px] font-semibold leading-tight tracking-[-0.01em] sm:pt-3" data-testid="nps-title">
            Посоветуете WeSetup коллегам?
          </div>
          {phase === "done" ? null : (
            <div className="mt-3 sm:ml-auto sm:mt-0 sm:w-[272px] sm:shrink-0">
              <div className="flex gap-2" role="group" aria-label="Оценка от 1 до 5: 1 — нет, 5 — да">
                {SCORES.map((n) => {
                  const active = score === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => pick(n)}
                      aria-pressed={active}
                      aria-label={`${n} из 5`}
                      data-testid={`nps-score-${n}`}
                      className={`h-12 min-w-0 flex-1 rounded-2xl text-[16px] font-semibold tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 ${
                        active
                          ? "bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)]"
                          : mini
                            ? "border border-current/20"
                            : "border border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                      }`}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
              <div className={`mt-1 flex justify-between px-1 text-[12px] ${faint.className ?? ""}`} style={faint.style} aria-hidden="true">
                <span>нет</span>
                <span>да</span>
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={close}
          aria-label={score === null ? "Не сейчас" : "Закрыть"}
          title={score === null ? "Не сейчас" : "Закрыть — оценка уже сохранена"}
          className={`-mr-2 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-full transition-colors duration-150 sm:mt-1.5 ${
            mini ? "opacity-60 hover:opacity-100" : "text-[#9b9fb3] hover:bg-[#f5f6ff] hover:text-[#0b1024]"
          }`}
          data-testid="nps-close"
        >
          <X className="size-4" />
        </button>
      </div>

      {phase === "done" ? (
        <p className={`mt-2 text-[14px] ${success.className ?? ""}`} style={success.style} role="status" data-testid="nps-done">
          {doneText}
        </p>
      ) : null}

      {phase === "answered" && recommend ? (
        <form onSubmit={sendRecommendation} noValidate className="mt-4 space-y-3 sm:max-w-[640px]" data-testid="nps-recommend-form">
          <div>
            <label htmlFor={`${ids}-email`} className={label}>
              Почта коллеги
            </label>
            <input
              id={`${ids}-email`}
              type="email"
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (error?.field === "email") setError(null);
              }}
              onBlur={() => setEmailTouched(true)}
              placeholder="name@company.ru"
              aria-invalid={error?.field === "email"}
              aria-describedby={error?.field === "email" ? `${ids}-email-error` : undefined}
              className={`mt-1.5 h-11 text-[15px] ${field}`}
              data-testid="nps-recommend-email"
            />
            {fieldError("email")}
            {emailSuggestion && error?.field !== "email" ? (
              <p className={`mt-1.5 text-[13px] leading-[1.5] ${muted.className ?? ""}`} style={muted.style}>
                {emailSuggestion.message}.{" "}
                <button
                  type="button"
                  onClick={() => setEmail(replaceDomain(email.trim(), emailSuggestion.suggestion))}
                  className="font-semibold text-[#3848c7] underline underline-offset-2"
                >
                  Исправить
                </button>
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor={`${ids}-message`} className={label}>
              Сообщение
            </label>
            <textarea
              id={`${ids}-message`}
              rows={4}
              maxLength={NPS_RECOMMEND_MESSAGE_MAX_LENGTH}
              value={message}
              onChange={(event) => {
                setMessage(event.target.value);
                if (error?.field === "message") setError(null);
              }}
              aria-invalid={error?.field === "message"}
              aria-describedby={error?.field === "message" ? `${ids}-message-error` : undefined}
              className={`mt-1.5 block resize-y py-3 text-[14px] leading-[1.55] ${field}`}
              data-testid="nps-recommend-message"
            />
            {fieldError("message")}
            {message.length > NPS_RECOMMEND_MESSAGE_MAX_LENGTH - 100 ? (
              <p className={`mt-1 text-right text-[12px] tabular-nums ${faint.className ?? ""}`} style={faint.style}>
                {message.length} / {NPS_RECOMMEND_MESSAGE_MAX_LENGTH}
              </p>
            ) : null}
          </div>
          {fieldError("form")}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <button type="submit" disabled={busy} className={submit} data-testid="nps-recommend-submit">
              {busy ? "Отправляем…" : "Отправить"}
            </button>
            <p className={`text-[12px] leading-[1.5] ${faint.className ?? ""}`} style={faint.style}>
              Письмо придёт от WeSetup с вашим именем. Не хотите — просто закройте: оценка сохранена.
            </p>
          </div>
        </form>
      ) : null}

      {phase === "answered" && !recommend ? (
        <form onSubmit={sendComment} noValidate className="mt-4 space-y-3 sm:max-w-[640px]" data-testid="nps-improve-form">
          <div>
            <label htmlFor={`${ids}-comment`} className={label}>
              Что улучшить?
            </label>
            <textarea
              id={`${ids}-comment`}
              rows={2}
              maxLength={NPS_COMMENT_MAX_LENGTH}
              value={comment}
              onChange={(event) => {
                setComment(event.target.value);
                if (error?.field === "comment") setError(null);
              }}
              placeholder="Пара слов — прочитаем каждое сообщение"
              aria-invalid={error?.field === "comment"}
              className={`mt-1.5 block resize-y py-3 text-[14px] leading-[1.55] ${field}`}
              data-testid="nps-improve-comment"
            />
            {fieldError("comment")}
          </div>
          {fieldError("form")}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <button type="submit" disabled={busy || !comment.trim()} className={submit} data-testid="nps-improve-submit">
              {busy ? "Отправляем…" : "Отправить"}
            </button>
            <p className={`text-[12px] leading-[1.5] ${faint.className ?? ""}`} style={faint.style}>
              Оценка уже сохранена.
            </p>
          </div>
        </form>
      ) : null}
    </div>
  );
}
