"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Loader2, MousePointerClick, RefreshCw, Sparkles } from "lucide-react";

import type { MailingKindFieldsProps } from "@/components/mailing/kind-fields";
import {
  POSTER_BODY_MAX,
  POSTER_BUTTON_TEXT_MAX,
  POSTER_HEADLINE_MAX,
  POSTER_LIMITS,
  POSTER_PUBLIC_PATH,
  POSTER_SCENES,
  POSTER_SCREENS,
  POSTER_SHORT_BODY_MAX,
  POSTER_SUBJECT_MAX,
  coercePosterPayload,
  posterCardPresets,
  posterTextsKey,
  type PosterArt,
  type PosterFormData,
  type PosterMailPayload,
  type PosterScene,
  type PosterScreen,
  type PosterTexts,
} from "@/lib/mailing/kinds/poster-shared";
import { MAILING_VARIABLES, isSafeLinkUrl } from "@/lib/mailing/text-format";
import { cn } from "@/lib/utils";

/**
 * Поля вида «Постер»: постер письма (сцена фона, генерация с ожиданием,
 * надписи и экран телефона, «Обновить надписи» без новой генерации) и
 * живой текст под ним — тема, заголовок, текст, кнопка.
 *
 * Генерация фона идёт 1–3 минуты: задание запоминается в браузере, и
 * если закрыть рассылку и вернуться, ожидание продолжится.
 */

const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60";
const TEXTAREA =
  "w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 py-3 text-[15px] leading-[1.6] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 disabled:opacity-60";
const LABEL = "mb-1.5 flex items-center justify-between gap-2 text-[13px] font-medium text-[#3c4053]";
const HINT = "mt-1.5 text-[12.5px] leading-[1.5] text-[#6f7282]";
const BUTTON =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl px-4 text-[14px] font-medium transition-colors duration-150 disabled:cursor-default disabled:opacity-60";
const CHIP =
  "inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60";

const JOB_KEY = "wesetup.mailing.poster.job";
const POLL_MS = 5000;

const TEXT_FIELDS: { key: keyof PosterTexts; label: string; placeholder: string }[] = [
  { key: "kicker", label: "Плашка над словом", placeholder: "Электронные журналы" },
  { key: "word", label: "Гигантское слово", placeholder: "ХАССП" },
  { key: "cardTitle", label: "Карточка: подпись", placeholder: "Бесплатно" },
  { key: "cardValue", label: "Карточка: крупно", placeholder: "14 дней" },
  { key: "cta", label: "Призыв над телефоном", placeholder: "Подключите за день" },
];

type Job = { id: string; startedAt: number };

function readJob(): Job | null {
  try {
    const raw = window.localStorage.getItem(JOB_KEY);
    const job = raw ? (JSON.parse(raw) as Job) : null;
    // Задание старше 20 минут не ждём: шлюз его уже не отдаст.
    return job && typeof job.id === "string" && Date.now() - job.startedAt < 20 * 60_000 ? job : null;
  } catch {
    return null;
  }
}

function writeJob(job: Job | null) {
  try {
    if (job) window.localStorage.setItem(JOB_KEY, JSON.stringify(job));
    else window.localStorage.removeItem(JOB_KEY);
  } catch {
    // Без localStorage ожидание просто не переживёт перезагрузку.
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
  return data;
}

function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function PosterFields({ payload, onChange, disabled, formData }: MailingKindFieldsProps<PosterMailPayload>) {
  const value = coercePosterPayload(payload);
  const art = value.poster;
  const data = (formData ?? null) as PosterFormData | null;
  // Последние данные — для ответов, пришедших после долгого ожидания.
  const latest = useRef(value);
  latest.current = value;
  const set = (patch: Partial<PosterMailPayload>) => onChange({ ...latest.current, ...patch });
  const setArt = (patch: Partial<PosterArt>) => onChange({ ...latest.current, poster: { ...latest.current.poster, ...patch } });

  const [job, setJob] = useState<Job | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function compose(next: PosterArt) {
    setComposing(true);
    setError(null);
    try {
      const result = await postJson<{ image: string; imageKey: string }>("/api/root/mailing/poster/compose", {
        background: next.background,
        screen: next.screen,
        kicker: next.kicker,
        word: next.word,
        cardTitle: next.cardTitle,
        cardValue: next.cardValue,
        cta: next.cta,
      });
      onChange({ ...latest.current, poster: { ...latest.current.poster, background: next.background, image: result.image, imageKey: result.imageKey } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Постер не собран");
    } finally {
      setComposing(false);
    }
  }

  // Ожидание фона: опрос раз в 5 секунд; задание переживает перезагрузку страницы.
  useEffect(() => {
    if (!job) {
      const saved = readJob();
      if (saved) setJob(saved);
      return;
    }
    let stopped = false;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    async function poll() {
      if (stopped || !job) return;
      try {
        const response = await fetch(`/api/root/mailing/poster/background?job=${encodeURIComponent(job.id)}`);
        const result = (await response.json().catch(() => ({}))) as { status?: string; background?: string; error?: string };
        if (stopped) return;
        if (!response.ok) throw new Error(result.error || `Ошибка ${response.status}`);
        if (result.status === "ready" && result.background) {
          writeJob(null);
          setJob(null);
          await compose({ ...latest.current.poster, background: result.background });
          return;
        }
      } catch (e) {
        if (stopped) return;
        writeJob(null);
        setJob(null);
        setError(e instanceof Error ? e.message : "Фон не сгенерирован");
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    }
    let timer = setTimeout(poll, 1500);
    return () => {
      stopped = true;
      clearInterval(tick);
      clearTimeout(timer);
    };
    // compose читает latest — зависимость только от задания.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  async function generate() {
    setError(null);
    try {
      const result = await postJson<{ job: string }>("/api/root/mailing/poster/background", { scene: art.scene });
      const next = { id: result.job, startedAt: Date.now() };
      writeJob(next);
      setNow(Date.now());
      setJob(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Генерация не запущена");
    }
  }

  const busy = Boolean(job) || composing;
  const stale = Boolean(art.image) && art.imageKey !== posterTextsKey(art);
  const preview = art.image || art.background;
  const presets = posterCardPresets(data);
  const buttonUrlBad = value.buttonUrl.trim() !== "" && !isSafeLinkUrl(value.buttonUrl.trim());

  return (
    <div className="space-y-5" data-testid="mailing-fields-poster">
      <section className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[#0b1024]">
          <ImageIcon className="size-4 text-[#5566f6]" />
          Постер письма
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
          <div>
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-[#0b1024]" style={{ backgroundImage: "radial-gradient(circle at 50% 30%, rgba(85,102,246,.55), transparent 65%)" }}>
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${POSTER_PUBLIC_PATH}${preview}`} alt="Постер письма" className={cn("h-full w-full object-cover", stale && "opacity-60")} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                  <span className="rounded-md bg-[#7cf5c0] px-2 py-0.5 text-[10px] font-bold uppercase text-[#0b1024]">{art.kicker || "Плашка"}</span>
                  <span className="text-[44px] font-extrabold uppercase leading-none tracking-tight text-[#8e9bf8]">{art.word || "ХАССП"}</span>
                  <span className="text-[12px] leading-[1.4] text-[#a3aef8]">Фон ещё не сгенерирован</span>
                </div>
              )}
              {busy ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0b1024]/70 p-4 text-center text-white">
                  <Loader2 className="size-6 animate-spin" />
                  <span className="text-[13px] font-medium">{job ? "Генерируем фон…" : "Собираем постер…"}</span>
                  {job ? <span className="text-[12px] tabular-nums text-[#a3aef8]">{elapsedLabel(now - job.startedAt)} · обычно 1–3 минуты</span> : null}
                </div>
              ) : null}
            </div>
            {art.image ? (
              <a href={`${POSTER_PUBLIC_PATH}${art.image}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[12.5px] text-[#3848c7] underline">
                Открыть постер 1080×1350
              </a>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={LABEL}>Фон</span>
                <select
                  value={art.scene}
                  disabled={disabled || busy}
                  onChange={(e) => setArt({ scene: e.target.value as PosterScene })}
                  className={INPUT}
                  data-testid="poster-scene"
                >
                  {POSTER_SCENES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={LABEL}>Экран телефона</span>
                <select
                  value={art.screen}
                  disabled={disabled || busy}
                  onChange={(e) => setArt({ screen: e.target.value as PosterScreen })}
                  className={INPUT}
                  data-testid="poster-screen"
                >
                  {POSTER_SCREENS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {TEXT_FIELDS.map((field) => (
                <label key={field.key} className={cn("block", field.key === "kicker" && "sm:col-span-2")}>
                  <span className={LABEL}>
                    {field.label}
                    <span className="tabular-nums text-[12px] font-normal text-[#9b9fb3]">
                      {art[field.key].length}/{POSTER_LIMITS[field.key]}
                    </span>
                  </span>
                  <input
                    value={art[field.key]}
                    disabled={disabled || busy}
                    maxLength={POSTER_LIMITS[field.key]}
                    onChange={(e) => setArt({ [field.key]: e.target.value } as Partial<PosterArt>)}
                    placeholder={field.placeholder}
                    className={INPUT}
                    data-testid={`poster-${field.key}`}
                  />
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-[#6f7282]">Карточка:</span>
              {presets.map((p) => (
                <button key={`${p.title}|${p.value}`} type="button" className={CHIP} disabled={disabled || busy} onClick={() => setArt({ cardTitle: p.title, cardValue: p.value })}>
                  {p.title} · {p.value}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={generate}
                disabled={disabled || busy}
                className={cn(BUTTON, "bg-[#5566f6] text-white hover:bg-[#4a5bf0]")}
                data-testid="poster-generate"
              >
                {job ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {art.background ? "Сгенерировать новый фон" : "Сгенерировать постер"}
              </button>
              <button
                type="button"
                onClick={() => compose(art)}
                disabled={disabled || busy || !art.background}
                className={cn(BUTTON, "border border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]")}
                data-testid="poster-compose"
              >
                {composing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4 text-[#5566f6]" />}
                Обновить надписи
              </button>
            </div>
            {error ? (
              <p className="text-[12.5px] leading-[1.5] text-[#a13a32]" role="alert">
                {error}
              </p>
            ) : stale ? (
              <p className="text-[12.5px] leading-[1.5] text-[#a13a32]">Надписи изменились — нажмите «Обновить надписи», иначе письмо не отправится.</p>
            ) : (
              <p className={HINT}>
                Фон без текста рисует генератор (1–3 минуты), надписи, телефон {`«${POSTER_SCREENS.find((s) => s.key === art.screen)?.title}»`} и контакты — сервер. Правка надписей пересобирает постер за секунды, фон остаётся прежним.
              </p>
            )}
          </div>
        </div>
      </section>

      <label className="block">
        <span className={LABEL}>
          Тема письма
          <span className="tabular-nums text-[12px] font-normal text-[#9b9fb3]">
            {value.subject.length}/{POSTER_SUBJECT_MAX}
          </span>
        </span>
        <input name="subject" value={value.subject} disabled={disabled} maxLength={POSTER_SUBJECT_MAX} onChange={(e) => set({ subject: e.target.value })} className={INPUT} />
      </label>

      <label className="block">
        <span className={LABEL}>
          Заголовок под постером
          <span className="tabular-nums text-[12px] font-normal text-[#9b9fb3]">
            {value.headline.length}/{POSTER_HEADLINE_MAX}
          </span>
        </span>
        <input name="headline" value={value.headline} disabled={disabled} maxLength={POSTER_HEADLINE_MAX} onChange={(e) => set({ headline: e.target.value })} className={INPUT} />
      </label>

      <label className="block">
        <span className={LABEL}>
          Текст под постером
          <span className="tabular-nums text-[12px] font-normal text-[#9b9fb3]">
            {value.body.length}/{POSTER_BODY_MAX}
          </span>
        </span>
        <textarea name="body" value={value.body} disabled={disabled} maxLength={POSTER_BODY_MAX} rows={7} onChange={(e) => set({ body: e.target.value })} className={TEXTAREA} />
        <p className={HINT}>
          Разметка как в «Сообщении»: <code className="rounded bg-[#f5f6ff] px-1">**жирный**</code>, <code className="rounded bg-[#f5f6ff] px-1">[текст](https://…)</code>, переменные{" "}
          {MAILING_VARIABLES.map((v) => `{${v.token}}`).join(", ")}.
        </p>
      </label>

      <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[#0b1024]">
          <MousePointerClick className="size-4 text-[#5566f6]" />
          Кнопка
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <label className="block">
            <span className={LABEL}>Текст кнопки</span>
            <input name="buttonText" value={value.buttonText} disabled={disabled} maxLength={POSTER_BUTTON_TEXT_MAX} onChange={(e) => set({ buttonText: e.target.value })} className={INPUT} />
          </label>
          <label className="block">
            <span className={LABEL}>Ссылка</span>
            <input name="buttonUrl" value={value.buttonUrl} disabled={disabled} inputMode="url" onChange={(e) => set({ buttonUrl: e.target.value })} className={INPUT} />
          </label>
        </div>
        {buttonUrlBad ? <p className="mt-2 text-[12px] text-[#a13a32]">Ссылка — адрес https://… или путь сайта вида /pricing</p> : null}
      </div>

      <label className="block">
        <span className={LABEL}>
          Короткий текст для Telegram и MAX
          <span className="tabular-nums text-[12px] font-normal text-[#9b9fb3]">
            {value.shortBody.length}/{POSTER_SHORT_BODY_MAX}
          </span>
        </span>
        <textarea name="shortBody" value={value.shortBody} disabled={disabled} maxLength={POSTER_SHORT_BODY_MAX} rows={3} onChange={(e) => set({ shortBody: e.target.value })} placeholder="Пусто — уйдёт полный текст" className={TEXTAREA} />
      </label>

      <div className="rounded-2xl border border-[#ececf4] bg-white p-4">
        <div className="text-[13px] font-semibold text-[#0b1024]">Если у получателя нет данных</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {MAILING_VARIABLES.map((v) => (
            <label key={v.key} className="block">
              <span className="mb-1 block text-[12px] font-medium text-[#6f7282]">{`{${v.token}}`} →</span>
              <input
                value={value.fallbacks[v.key]}
                disabled={disabled}
                maxLength={60}
                onChange={(e) => set({ fallbacks: { ...value.fallbacks, [v.key]: e.target.value } })}
                placeholder={v.defaultFallback}
                className="h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
