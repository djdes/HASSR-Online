"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Bot, CalendarClock, CheckCircle2, Eye, Loader2, Mail, MessageCircle, Plus, RotateCcw, Save, Send, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  AI_DIGEST_CHANNELS,
  AI_DIGEST_CHANNEL_LABELS,
  AI_DIGEST_TELEGRAM_EXTRA_MAX,
  AI_DIGEST_SECTIONS,
  AI_DIGEST_SECTION_LABELS,
  AI_DIGEST_VARIABLES,
  type AiDigestChannel,
  type AiDigestConfig,
} from "@/lib/mailing/ai-digest/config";
import type { AiDigestRun } from "@/lib/mailing/ai-digest/run.server";
import { WEEKDAY_LABELS, type DigestWeekday } from "@/lib/mailing/ai-digest/schedule";
import type { AiDigestState } from "@/lib/mailing/ai-digest/state.server";
import { cn } from "@/lib/utils";

import { CARD, CHECKBOX, FilterSelect, INPUT, Notice, OUTLINE, OUTLINE_SM, PRIMARY, SECTION_LABEL, api, formatDateTime } from "./ui";

/**
 * ROOT → «Рассылка» → «ИИ-сводка»: автокампания, которая по расписанию
 * (по умолчанию вс 23:59 МСК) шлёт пользователям root полную сводку
 * продаж и рассылок на почту и короткую — в Telegram и MAX. Здесь —
 * расписание, каналы, шаблон, предпросмотр, «Отправить сейчас» и история.
 */

type Preview = { subject: string; html: string; telegram: string; max: string; notes: string[]; period: string };

const TEXTAREA =
  "w-full rounded-2xl border border-[#dcdfed] bg-white px-3.5 py-3 text-[15px] leading-relaxed text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

const RUN_STATUS: Record<AiDigestRun["status"], { label: string; className: string }> = {
  running: { label: "Отправляется", className: "bg-[#eef1ff] text-[#3848c7]" },
  sent: { label: "Отправлена", className: "bg-[#e8f7ee] text-[#137a3a]" },
  partial: { label: "Отправлена частично", className: "bg-[#fff8eb] text-[#7a4b12]" },
  failed: { label: "Не отправлена", className: "bg-[#fff4f2] text-[#a13a32]" },
};

const DELIVERY_STATUS: Record<string, string> = { sent: "ушло", failed: "ошибка", skipped: "пропущено" };
const CHANNEL_SHORT: Record<AiDigestChannel, string> = { email: "Почта", telegram: "Telegram", max: "MAX" };

function sameConfig(a: AiDigestConfig, b: AiDigestConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function formatRub(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
}

export function AiDigestTab() {
  const [state, setState] = useState<AiDigestState | null>(null);
  const [draft, setDraft] = useState<AiDigestConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const shortRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async (resetDraft: boolean) => {
    try {
      const next = await api<AiDigestState>("/api/root/mailing/ai-digest");
      setState(next);
      setLoadError(null);
      if (resetDraft) setDraft(next.config);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Не удалось загрузить");
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const running = state?.runs.some((r) => r.status === "running") ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load(false), 5000);
    return () => clearInterval(timer);
  }, [running, load]);

  if (!state || !draft) {
    return (
      <div className={cn(CARD, "flex items-center gap-3 text-[14px] text-[#6f7282]")}>
        {loadError ? (
          <>
            <TriangleAlert className="size-4 text-[#a13a32]" /> {loadError}
            <button type="button" className={OUTLINE_SM} onClick={() => void load(true)}>
              Повторить
            </button>
          </>
        ) : (
          <>
            <Loader2 className="size-4 animate-spin" /> Загружаем ИИ-сводку…
          </>
        )}
      </div>
    );
  }

  const dirty = !sameConfig(draft, state.config);
  const patch = (p: Partial<AiDigestConfig>) => setDraft((d) => (d ? { ...d, ...p } : d));

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await api<AiDigestState>("/api/root/mailing/ai-digest", { method: "PUT", json: { config: draft } });
      setState(next);
      setDraft(next.config);
      toast.success("Сводка сохранена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  async function runPreview() {
    if (!draft) return;
    setPreviewing(true);
    try {
      setPreview(await api<Preview>("/api/root/mailing/ai-digest/preview", { method: "POST", json: { config: draft } }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось собрать предпросмотр");
    } finally {
      setPreviewing(false);
    }
  }

  async function sendNow() {
    try {
      await api("/api/root/mailing/ai-digest/send", { method: "POST" });
      toast.success("Сводка готовится: ИИ пишет текст, это до 2–3 минут");
      await load(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить");
    }
  }

  function insertVariable(key: string) {
    const el = shortRef.current;
    const token = `{${key}}`;
    if (!el || !draft) {
      patch({ shortTemplate: `${draft?.shortTemplate ?? ""}${token}` });
      return;
    }
    const start = el.selectionStart ?? draft.shortTemplate.length;
    const end = el.selectionEnd ?? start;
    patch({ shortTemplate: draft.shortTemplate.slice(0, start) + token + draft.shortTemplate.slice(end) });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const channelReady: Record<AiDigestChannel, { ok: boolean; note: string }> = {
    email: { ok: true, note: `${state.recipients.length} адрес(ов)` },
    telegram: state.telegramConfigured
      ? { ok: state.recipients.some((r) => r.telegram), note: `привязан у ${state.recipients.filter((r) => r.telegram).length} из ${state.recipients.length}` }
      : { ok: false, note: "бот Telegram не настроен на сервере" },
    max: state.maxConfigured
      ? { ok: state.recipients.some((r) => r.max), note: `привязан у ${state.recipients.filter((r) => r.max).length} из ${state.recipients.length}` }
      : { ok: false, note: "бот MAX не настроен на сервере" },
  };

  return (
    <div className="space-y-5" data-testid="ai-digest-tab">
      {/* Шапка: статус, расписание, получатели, действия */}
      <section className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
                <Bot className="size-5" />
              </span>
              <h2 className="text-[18px] font-semibold text-[#0b1024]">ИИ-сводка администратору</h2>
            </div>
            <p className="mt-2 max-w-[720px] text-[14px] leading-relaxed text-[#6f7282]">
              Каждую неделю ИИ разбирает продажи и рассылки, сравнивает с прошлой неделей, объясняет изменение среднего чека и
              советует, как его поднять. Полная сводка — на почту, коротко — в Telegram и MAX. Получатели — все пользователи
              root.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
                  state.config.enabled ? "bg-[#e8f7ee] text-[#137a3a]" : "bg-[#f3f3f8] text-[#6f7282]"
                )}
              >
                <CalendarClock className="size-3.5" />
                {state.config.enabled ? `Следующая отправка: ${state.nextRun}` : "Выключена — по расписанию не уходит"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={OUTLINE} onClick={() => void runPreview()} disabled={previewing} data-testid="ai-digest-preview">
              {previewing ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
              Предпросмотр
            </button>
            <button
              type="button"
              className={PRIMARY}
              onClick={() => setConfirmSend(true)}
              disabled={running || dirty || state.recipients.length === 0}
              title={dirty ? "Сначала сохраните изменения" : undefined}
              data-testid="ai-digest-send"
            >
              {running ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {running ? "Отправляется…" : "Отправить сейчас"}
            </button>
          </div>
        </div>

        <div className="mt-5">
          <div className={SECTION_LABEL}>Получатели</div>
          {state.recipients.length === 0 ? (
            <div className="mt-2">
              <Notice tone="danger" icon={<TriangleAlert />}>
                Нет активных пользователей root — сводку некому отправить.
              </Notice>
            </div>
          ) : (
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {state.recipients.map((r) => (
                <li key={r.id} className="rounded-2xl border border-[#ececf4] px-3.5 py-2.5">
                  <div className="truncate text-[14px] font-medium text-[#0b1024]">{r.name || r.email}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[12px]">
                    <ChannelChip ok label={r.email} icon={<Mail className="size-3" />} />
                    <ChannelChip ok={r.telegram} label={r.telegram ? "Telegram" : "Telegram не привязан"} icon={<Send className="size-3" />} />
                    <ChannelChip ok={r.max} label={r.max ? "MAX" : "MAX не привязан"} icon={<MessageCircle className="size-3" />} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {state.config.telegramExtra.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="text-[#6f7282]">Ещё в Telegram:</span>
              {state.config.telegramExtra.map((x) => (
                <ChannelChip key={x.chatId} ok label={x.label || x.chatId} icon={<Send className="size-3" />} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Расписание и каналы */}
      <section className={CARD}>
        <div className={SECTION_LABEL}>Расписание и каналы</div>
        <label className="mt-3 flex items-center gap-2.5 text-[14px] text-[#0b1024]">
          <input
            type="checkbox"
            className={CHECKBOX}
            checked={draft.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
            data-testid="ai-digest-enabled"
          />
          Отправлять по расписанию
        </label>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,240px)_minmax(0,160px)]">
          <FilterSelect
            label="День недели"
            value={String(draft.schedule.weekday)}
            onChange={(v) => patch({ schedule: { ...draft.schedule, weekday: Number(v) as DigestWeekday } })}
            options={([1, 2, 3, 4, 5, 6, 7] as DigestWeekday[]).map((d) => ({ value: String(d), label: WEEKDAY_LABELS[d] }))}
            testId="ai-digest-weekday"
          />
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-[#6f7282]">Время (МСК)</span>
            <input
              type="time"
              className={INPUT}
              value={draft.schedule.time}
              onChange={(e) => patch({ schedule: { ...draft.schedule, time: e.target.value } })}
              data-testid="ai-digest-time"
            />
          </label>
        </div>
        <p className="mt-2 text-[13px] text-[#6f7282]">
          В воскресенье сводка описывает текущую неделю (пн–вс), в другие дни — прошлую целиком. ИИ пишет текст до 2–3 минут
          после назначенного времени.
        </p>
        <div className="mt-4 grid gap-2">
          {AI_DIGEST_CHANNELS.map((channel) => (
            <label key={channel} className="flex items-start gap-2.5 text-[14px] text-[#0b1024]">
              <input
                type="checkbox"
                className={cn(CHECKBOX, "mt-0.5")}
                checked={draft.channels[channel]}
                onChange={(e) => patch({ channels: { ...draft.channels, [channel]: e.target.checked } })}
                data-testid={`ai-digest-channel-${channel}`}
              />
              <span>
                {AI_DIGEST_CHANNEL_LABELS[channel]}
                <span className={cn("ml-2 text-[12px]", channelReady[channel].ok ? "text-[#6f7282]" : "text-[#a13a32]")}>
                  {channelReady[channel].note}
                </span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-5">
          <div className="text-[13px] font-medium text-[#0b1024]">Ещё получатели в Telegram</div>
          <p className="mt-1 text-[13px] text-[#6f7282]">
            Короткий текст уйдёт и им — помимо пользователей root. Нужен числовой chat_id; человек должен один раз нажать
            «Старт» у бота WeSetup.
          </p>
          {draft.telegramExtra.length > 0 && (
            <ul className="mt-2 grid gap-2">
              {draft.telegramExtra.map((x, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input
                    className={cn(INPUT, "max-w-[180px]")}
                    inputMode="numeric"
                    placeholder="chat_id"
                    value={x.chatId}
                    onChange={(e) =>
                      patch({ telegramExtra: draft.telegramExtra.map((y, j) => (j === i ? { ...y, chatId: e.target.value.trim() } : y)) })
                    }
                    data-testid={`ai-digest-tg-extra-chat-${i}`}
                  />
                  <input
                    className={cn(INPUT, "max-w-[240px]")}
                    placeholder="Подпись, например @djdes"
                    value={x.label}
                    onChange={(e) =>
                      patch({ telegramExtra: draft.telegramExtra.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) })
                    }
                    data-testid={`ai-digest-tg-extra-label-${i}`}
                  />
                  <button
                    type="button"
                    className={OUTLINE_SM}
                    aria-label="Убрать получателя"
                    onClick={() => patch({ telegramExtra: draft.telegramExtra.filter((_, j) => j !== i) })}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {draft.telegramExtra.length < AI_DIGEST_TELEGRAM_EXTRA_MAX && (
            <button
              type="button"
              className={cn(OUTLINE_SM, "mt-2")}
              onClick={() => patch({ telegramExtra: [...draft.telegramExtra, { chatId: "", label: "" }] })}
              data-testid="ai-digest-tg-extra-add"
            >
              <Plus className="size-4" />
              Добавить получателя
            </button>
          )}
        </div>
      </section>

      {/* Шаблон письма */}
      <section className={CARD}>
        <div className={SECTION_LABEL}>Письмо — полная сводка</div>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-[12px] font-medium text-[#6f7282]">Тема</span>
          <input
            className={INPUT}
            value={draft.emailSubject}
            onChange={(e) => patch({ emailSubject: e.target.value })}
            data-testid="ai-digest-subject"
          />
        </label>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-[12px] font-medium text-[#6f7282]">Вступление (перед цифрами)</span>
          <textarea
            className={TEXTAREA}
            rows={4}
            value={draft.emailIntro}
            onChange={(e) => patch({ emailIntro: e.target.value })}
            data-testid="ai-digest-intro"
          />
        </label>
        <div className="mt-4 text-[12px] font-medium text-[#6f7282]">Разделы письма</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {AI_DIGEST_SECTIONS.map((section) => (
            <label key={section} className="flex items-start gap-2.5 text-[14px] text-[#0b1024]">
              <input
                type="checkbox"
                className={cn(CHECKBOX, "mt-0.5")}
                checked={draft.sections[section]}
                onChange={(e) => patch({ sections: { ...draft.sections, [section]: e.target.checked } })}
              />
              {AI_DIGEST_SECTION_LABELS[section]}
            </label>
          ))}
        </div>
      </section>

      {/* Указания ИИ */}
      <section className={CARD}>
        <div className={SECTION_LABEL}>Указания для ИИ</div>
        <p className="mt-2 text-[13px] text-[#6f7282]">
          Цифры недели и формат ответа ИИ получает сам. Здесь — на что обратить внимание, каким тоном писать, какие
          предложения считать уместными.
        </p>
        <textarea
          className={cn(TEXTAREA, "mt-3")}
          rows={4}
          value={draft.aiInstructions}
          onChange={(e) => patch({ aiInstructions: e.target.value })}
          data-testid="ai-digest-instructions"
        />
        <div className="mt-3 max-w-[240px]">
          <FilterSelect
            label="Сколько рекомендаций"
            value={String(draft.recommendationsCount)}
            onChange={(v) => patch({ recommendationsCount: Number(v) })}
            options={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: String(n) }))}
          />
        </div>
      </section>

      {/* Короткий текст */}
      <section className={CARD}>
        <div className={SECTION_LABEL}>Telegram и MAX — коротко</div>
        <p className="mt-2 text-[13px] text-[#6f7282]">
          Первая строка в Telegram — жирным. Строка, где переменная оказалась пустой, убирается.
        </p>
        <textarea
          ref={shortRef}
          className={cn(TEXTAREA, "mt-3 font-mono text-[14px]")}
          rows={7}
          value={draft.shortTemplate}
          onChange={(e) => patch({ shortTemplate: e.target.value })}
          data-testid="ai-digest-short"
        />
        <div className="mt-3 text-[12px] font-medium text-[#6f7282]">Переменные (нажмите — вставится в короткий текст; работают и в теме, и во вступлении)</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {AI_DIGEST_VARIABLES.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => insertVariable(v.key)}
              title={v.label}
              className="rounded-xl border border-[#dcdfed] bg-white px-2.5 py-1 font-mono text-[12px] text-[#3848c7] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              {`{${v.key}}`}
            </button>
          ))}
        </div>
      </section>

      {/* Сохранить */}
      <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-3xl border border-[#ececf4] bg-white/95 p-3 shadow-[0_10px_30px_-18px_rgba(11,16,36,0.35)] backdrop-blur">
        <button type="button" className={PRIMARY} onClick={() => void save()} disabled={!dirty || saving} data-testid="ai-digest-save">
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Сохранить
        </button>
        <button type="button" className={OUTLINE} onClick={() => setDraft(state.config)} disabled={!dirty || saving}>
          Отменить правки
        </button>
        <button
          type="button"
          className={OUTLINE}
          onClick={() => setDraft({ ...state.defaults, enabled: draft.enabled })}
          disabled={saving}
          title="Тема, тексты, разделы и расписание — как было изначально"
        >
          <RotateCcw className="size-4" />
          Шаблон по умолчанию
        </button>
        <span className="text-[13px] text-[#6f7282]">{dirty ? "Есть несохранённые изменения" : "Всё сохранено"}</span>
      </div>

      {/* Предпросмотр */}
      {preview ? (
        <section className={CARD} data-testid="ai-digest-preview-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={SECTION_LABEL}>Предпросмотр — неделя {preview.period}</div>
            <button type="button" className={OUTLINE_SM} onClick={() => setPreview(null)}>
              Скрыть
            </button>
          </div>
          {preview.notes.map((n) => (
            <div key={n} className="mt-3">
              <Notice tone="info" icon={<Bot />}>
                {n}
              </Notice>
            </div>
          ))}
          <div className="mt-3 text-[14px] text-[#0b1024]">
            <span className="text-[#6f7282]">Тема:</span> <b>{preview.subject}</b>
          </div>
          <iframe
            title="Письмо сводки"
            srcDoc={preview.html}
            sandbox=""
            className="mt-3 h-[640px] w-full rounded-2xl border border-[#ececf4] bg-white"
          />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <ShortPreview title="Telegram" text={preview.telegram} html />
            <ShortPreview title="MAX" text={preview.max} />
          </div>
        </section>
      ) : null}

      {/* История */}
      <section className={CARD}>
        <div className="flex items-center justify-between gap-2">
          <div className={SECTION_LABEL}>История отправок</div>
          <button type="button" className={OUTLINE_SM} onClick={() => void load(false)}>
            Обновить
          </button>
        </div>
        {state.runs.length === 0 ? (
          <p className="mt-3 text-[14px] text-[#6f7282]">Сводка ещё не отправлялась.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[#f0f0f6]">
            {state.runs.map((run) => {
              const status = RUN_STATUS[run.status];
              const open = openRun === run.id;
              return (
                <li key={run.id} className="py-3" data-testid="ai-digest-run">
                  <div className="flex flex-wrap items-center gap-2 text-[14px]">
                    <span className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-medium", status.className)}>{status.label}</span>
                    <span className="text-[#0b1024]">{formatDateTime(run.startedAt)}</span>
                    <span className="text-[#6f7282]">
                      {run.trigger === "schedule" ? "по расписанию" : `вручную${run.actor ? ` — ${run.actor}` : ""}`}
                    </span>
                    {run.period ? <span className="text-[#6f7282]">· неделя {run.period}</span> : null}
                    {run.ai === "ok" ? (
                      <span className="inline-flex items-center gap-1 text-[12px] text-[#137a3a]">
                        <CheckCircle2 className="size-3.5" /> текст ИИ
                      </span>
                    ) : run.ai === "fallback" ? (
                      <span className="text-[12px] text-[#7a4b12]">без ИИ</span>
                    ) : null}
                    {run.status !== "running" ? (
                      <button type="button" className={cn(OUTLINE_SM, "ml-auto")} onClick={() => setOpenRun(open ? null : run.id)}>
                        {open ? "Свернуть" : "Подробнее"}
                      </button>
                    ) : null}
                  </div>
                  {run.orders !== null ? (
                    <div className="mt-1 text-[13px] text-[#6f7282]">
                      Выручка {formatRub(run.revenue)}, оплат {run.orders}, средний чек {formatRub(run.avgCheck)}
                    </div>
                  ) : null}
                  {open ? (
                    <div className="mt-3 space-y-3">
                      {run.error ? (
                        <Notice tone="danger" icon={<TriangleAlert />}>
                          {run.error}
                        </Notice>
                      ) : null}
                      {run.aiNote ? (
                        <Notice tone="warn" icon={<Bot />}>
                          {run.aiNote}
                        </Notice>
                      ) : null}
                      {run.deliveries.length > 0 ? (
                        <ul className="grid gap-1 text-[13px]">
                          {run.deliveries.map((d, i) => (
                            <li key={i} className="flex flex-wrap gap-1.5">
                              <span className="font-medium text-[#0b1024]">{CHANNEL_SHORT[d.channel]}</span>
                              <span className="text-[#6f7282]">→ {d.recipient}:</span>
                              <span className={d.status === "sent" ? "text-[#137a3a]" : d.status === "failed" ? "text-[#a13a32]" : "text-[#7a4b12]"}>
                                {DELIVERY_STATUS[d.status]}
                              </span>
                              {d.detail ? <span className="text-[#6f7282]">({d.detail})</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {run.subject ? (
                        <div className="text-[13px] text-[#0b1024]">
                          <span className="text-[#6f7282]">Тема:</span> {run.subject}
                        </div>
                      ) : null}
                      {run.short ? <ShortPreview title="Короткий текст" text={run.short} /> : null}
                      {run.html ? (
                        <iframe
                          title="Отправленное письмо"
                          srcDoc={run.html}
                          sandbox=""
                          className="h-[560px] w-full rounded-2xl border border-[#ececf4] bg-white"
                        />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirmSend}
        onClose={() => setConfirmSend(false)}
        onConfirm={async () => {
          setConfirmSend(false);
          await sendNow();
        }}
        title="Отправить сводку сейчас?"
        description="Вне расписания: сводка по сохранённому шаблону уйдёт всем пользователям root. Плановая отправка останется как есть."
        bullets={AI_DIGEST_CHANNELS.filter((c) => state.config.channels[c]).map((c) => ({
          label: AI_DIGEST_CHANNEL_LABELS[c],
        }))}
        confirmLabel="Отправить"
      />
    </div>
  );
}

function ChannelChip({ ok, label, icon }: { ok: boolean; label: string; icon: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5",
        ok ? "bg-[#eef1ff] text-[#3848c7]" : "bg-[#f3f3f8] text-[#9b9fb3]"
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Короткий текст как в мессенджере; для Telegram — его HTML (только <b>). */
function ShortPreview({ title, text, html = false }: { title: string; text: string; html?: boolean }) {
  const plain = html ? text.replace(/<\/?b>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&") : text;
  const [first, ...rest] = plain.split("\n");
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-[#f7f8fc] p-3.5">
      <div className="text-[12px] font-medium text-[#6f7282]">{title}</div>
      <div className="mt-2 whitespace-pre-wrap rounded-2xl bg-white px-3.5 py-2.5 text-[14px] leading-relaxed text-[#0b1024] shadow-[0_1px_2px_rgba(11,16,36,0.06)]">
        {html ? <b>{first}</b> : first}
        {rest.length ? `\n${rest.join("\n")}` : ""}
      </div>
    </div>
  );
}
