"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  Eye,
  FlaskConical,
  Info,
  Loader2,
  Mail,
  PenSquare,
  Send,
  ShieldAlert,
  Upload,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PlanStats } from "@/lib/mailing/audience.server";
import type { MailingBase } from "@/lib/mailing/bases";
import type { TestSendResult } from "@/lib/mailing/campaigns.server";
import { CHANNEL_LABELS, CHANNEL_STATUS_LABELS, MAILING_CHANNELS, type MailingChannel } from "@/lib/mailing/labels";
import { MAILING_PRESETS, PRESET_AUDIENCE_LABELS, type MailingPreset } from "@/lib/mailing/presets";
import type { RenderedMailing } from "@/lib/mailing/templates";
import { pluralRu } from "@/lib/plural-ru";
import { cn } from "@/lib/utils";

import { PreviewPane, type PreviewState } from "./compose-tab";
import { ImportCard } from "./contacts-tab";
import type { MailingPageData } from "./types";
import { CARD, CHANNEL_ICONS, ChannelIcons, Notice, OUTLINE, OUTLINE_SM, PRIMARY, SECTION_LABEL, api } from "./ui";

/**
 * Простой режим «Рассылки»: база адресов → готовое письмо → отправка.
 * Писать ничего не нужно: письма — `src/lib/mailing/presets.ts` (их готовит
 * Claude), базы — сегменты клиентов и загруженные контакты. Под капотом —
 * обычный черновик и обычный запуск, как у конструктора.
 */
export function QuickTab({
  data,
  advanced,
  onLaunched,
  onOpenInConstructor,
}: {
  data: MailingPageData;
  advanced: boolean;
  onLaunched: (campaignId: string) => void;
  onOpenInConstructor: (preset: MailingPreset) => void;
}) {
  const [bases, setBases] = useState<MailingBase[]>(data.bases);
  const [baseIds, setBaseIds] = useState<string[]>([]);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [stats, setStats] = useState<PlanStats | null>(null);
  const [deliverable, setDeliverable] = useState(0);
  const [statsBusy, setStatsBusy] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [previewChannel, setPreviewChannel] = useState<MailingChannel>("email");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<TestSendResult | null>(null);
  const [confirm, setConfirm] = useState<"now" | "schedule" | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const preset = presetId ? (MAILING_PRESETS.find((p) => p.id === presetId) ?? null) : null;
  const clientBases = bases.filter((b) => b.kind === "clients");
  const contactBases = bases.filter((b) => b.kind === "contacts");
  const chosenBases = bases.filter((b) => baseIds.includes(b.id));
  const ready = Boolean(preset) && baseIds.length > 0;
  const planKey = ready ? `${presetId}|${[...baseIds].sort().join("|")}` : "";

  // Охват: сколько реально получат письмо выбранного шаблона.
  useEffect(() => {
    if (!planKey) {
      setStats(null);
      setStatsError(null);
      return;
    }
    let alive = true;
    setStatsBusy(true);
    const t = setTimeout(() => {
      api<{ stats: PlanStats; deliverable: number }>("/api/root/mailing/quick", {
        method: "POST",
        json: { presetId, baseIds },
      })
        .then((r) => {
          if (!alive) return;
          setStats(r.stats);
          setDeliverable(r.deliverable);
          setStatsError(null);
        })
        .catch((error) => alive && setStatsError(error instanceof Error ? error.message : "Не удалось посчитать"))
        .finally(() => alive && setStatsBusy(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  // Предпросмотр выбранного шаблона на примере получателя.
  useEffect(() => {
    if (!preset) {
      setPreview(null);
      return;
    }
    let alive = true;
    setPreview(null);
    const first = MAILING_CHANNELS.find((c) => preset.channels[c]) ?? "email";
    setPreviewChannel(first);
    api<{ label: string; rendered: RenderedMailing }>("/api/root/mailing/preview", {
      method: "POST",
      json: { kind: preset.kind, payload: preset.payload, recipient: null },
    })
      .then((r) => alive && setPreview(r))
      .catch((error) => alive && setPreview({ error: error instanceof Error ? error.message : "Нет предпросмотра" }));
    return () => {
      alive = false;
    };
  }, [preset]);

  function toggleBase(id: string, on: boolean) {
    setBaseIds((prev) => (on ? [...new Set([...prev, id])] : prev.filter((b) => b !== id)));
    setTestResult(null);
  }

  /** Черновик под текущий выбор: один на экран, обновляется при смене выбора. */
  async function ensureDraft(): Promise<string | null> {
    try {
      const r = await api<{ campaignId: string; stats: PlanStats; deliverable: number }>("/api/root/mailing/quick", {
        method: "POST",
        json: { presetId, baseIds, campaignId, save: true },
      });
      setCampaignId(r.campaignId);
      setStats(r.stats);
      setDeliverable(r.deliverable);
      return r.campaignId;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось подготовить рассылку");
      return null;
    }
  }

  async function runTest() {
    setTestBusy(true);
    setTestResult(null);
    try {
      const id = await ensureDraft();
      if (!id) return;
      const r = await api<TestSendResult>(`/api/root/mailing/campaigns/${id}/test`, { method: "POST" });
      setTestResult(r);
      toast.success(r.email ? `Тест отправлен на ${r.email}` : "Тест выполнен — результат ниже");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Тест не удался");
    } finally {
      setTestBusy(false);
    }
  }

  async function launch(mode: "now" | "schedule") {
    const id = await ensureDraft();
    if (!id) throw new Error("no draft");
    try {
      const r = await api<{ stats: PlanStats }>(`/api/root/mailing/campaigns/${id}/launch`, {
        method: "POST",
        json: { mode, scheduledAt: mode === "schedule" ? scheduledAt : null },
      });
      toast.success(
        mode === "now"
          ? `Рассылка запущена: ${r.stats.recipients} ${pluralRu(r.stats.recipients, "получатель", "получателя", "получателей")}`
          : `Рассылка запланирована на ${scheduledAt.replace("T", " ")} МСК`
      );
      setConfirm(null);
      setCampaignId(null);
      onLaunched(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось запустить");
      throw error;
    }
  }

  async function reloadBases(selectSource: string | null) {
    try {
      const r = await api<{ bases: MailingBase[] }>("/api/root/mailing/quick");
      setBases(r.bases);
      if (selectSource) {
        const id = `contacts:${selectSource}`;
        if (r.bases.some((b) => b.id === id)) toggleBase(id, true);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось обновить базы");
    }
  }

  const email = stats?.channels.email;
  const emailQueued = preset?.channels.email ? (email?.queued ?? 0) : 0;
  const leftToday = Math.max(0, data.settings.perDay - data.sentToday);
  const minutes = emailQueued > 0 ? Math.ceil(Math.min(emailQueued, leftToday) / data.settings.perMinute) : 0;
  const reachable = stats ? deliverable : 0;
  const canSend = ready && !statsBusy && reachable > 0;

  const previewChannels = useMemo(
    () => (preset ? MAILING_CHANNELS.filter((c) => preset.channels[c]) : []),
    [preset]
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]" data-testid="mailing-quick-tab">
      <div className="min-w-0 space-y-5">
        <section className={CARD} data-testid="quick-bases">
          <StepTitle n={1} done={baseIds.length > 0} title="Кому отправить" hint="Отметьте одну или несколько баз." />
          <div className={cn(SECTION_LABEL, "mb-2 mt-5")}>Клиенты WeSetup</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {clientBases.map((b) => (
              <BaseCard key={b.id} base={b} checked={baseIds.includes(b.id)} onChange={(on) => toggleBase(b.id, on)} />
            ))}
          </div>
          <div className="mb-2 mt-5 flex flex-wrap items-center justify-between gap-2">
            <div className={SECTION_LABEL}>Загруженные базы</div>
            <button type="button" className={OUTLINE_SM} onClick={() => setImportOpen(true)} data-testid="quick-import-open">
              <Upload className="size-4 text-[#5566f6]" /> Загрузить новую базу
            </button>
          </div>
          {contactBases.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {contactBases.map((b) => (
                <BaseCard key={b.id} base={b} checked={baseIds.includes(b.id)} onChange={(on) => toggleBase(b.id, on)} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-6 text-center">
              <div className="text-[14px] font-medium text-[#0b1024]">Загруженных баз пока нет</div>
              <p className="mx-auto mt-1 max-w-[420px] text-[13px] text-[#6f7282]">
                Загрузите файл CSV или вставьте адреса — база появится здесь, и ей можно будет отправить письмо.
              </p>
            </div>
          )}
        </section>

        <section className={CARD} data-testid="quick-presets">
          <StepTitle
            n={2}
            done={Boolean(preset)}
            title="Какое письмо"
            hint="Готовые письма. Нужно другое — попросите Claude, он добавит его сюда."
          />
          <div className="mt-5 grid gap-2">
            {MAILING_PRESETS.map((p) => {
              const active = p.id === presetId;
              return (
                <div
                  key={p.id}
                  className={cn(
                    "rounded-2xl border p-4 transition-colors duration-150",
                    active ? "border-[#5566f6]/45 bg-[#f5f6ff]" : "border-[#ececf4] bg-white hover:border-[#5566f6]/30 hover:bg-[#fafbff]"
                  )}
                >
                  <label className="flex cursor-pointer items-start gap-3" data-testid={`quick-preset-${p.id}`}>
                    <input
                      type="radio"
                      name="mailing-preset"
                      checked={active}
                      onChange={() => {
                        setPresetId(p.id);
                        setTestResult(null);
                      }}
                      className="mt-1 size-4 shrink-0 cursor-pointer accent-[#5566f6]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-[#0b1024]">{p.title}</span>
                      <span className="mt-1 block text-[13px] leading-[1.55] text-[#6f7282]">{p.description}</span>
                      <span className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-white px-2 py-0.5 text-[12px] text-[#6f7282] ring-1 ring-[#ececf4]">
                          {PRESET_AUDIENCE_LABELS[p.audience]}
                        </span>
                        <ChannelIcons channels={p.channels} />
                      </span>
                    </span>
                  </label>
                  {advanced ? (
                    <button
                      type="button"
                      className="mt-2 ml-7 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#3848c7] hover:underline"
                      onClick={() => onOpenInConstructor(p)}
                    >
                      <PenSquare className="size-3.5" /> Открыть в конструкторе
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="min-w-0 space-y-5 xl:sticky xl:top-6 xl:self-start">
        <section className={CARD} data-testid="quick-send">
          <StepTitle n={3} done={false} title="Отправка" />
          <div className="mt-4 space-y-3">
            <Summary
              ready={ready}
              busy={statsBusy}
              error={statsError}
              stats={stats}
              preset={preset}
              chosen={chosenBases}
              reachable={reachable}
            />
            {ready && emailQueued > 0 ? (
              <p className="text-[13px] leading-[1.55] text-[#6f7282]" data-testid="quick-rate">
                Письма уходят по {data.settings.perMinute} в минуту — эта рассылка займёт около {minutes} мин.
                {emailQueued > leftToday
                  ? ` Сегодня можно отправить ещё ${leftToday} — остальные уйдут завтра (лимит ${data.settings.perDay} в сутки).`
                  : ""}
              </p>
            ) : null}
            {!data.sender.separateSender && preset?.channels.email ? (
              <Notice tone="warn" icon={<ShieldAlert />}>
                Письма уходят с {data.sender.fromAddress} — с того же адреса, что коды входа и счета.
              </Notice>
            ) : null}
            {data.sender.mode === "dry-run-dir" || data.sender.mode === "log-only" ? (
              <Notice tone="info" icon={<Info />}>
                Сухая отправка: наружу ничего не уйдёт, письма только в{" "}
                {data.sender.mode === "dry-run-dir" ? `папке ${data.sender.dryRunDir}` : "логе сервера"}.
              </Notice>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <button
                type="button"
                className={PRIMARY}
                disabled={!canSend}
                onClick={() => setConfirm("now")}
                data-testid="quick-send-now"
              >
                <Send className="size-4" /> Отправить сейчас
              </button>
              <button
                type="button"
                className={OUTLINE}
                disabled={!ready || testBusy}
                onClick={() => void runTest()}
                data-testid="quick-test"
              >
                {testBusy ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4 text-[#5566f6]" />}
                Прислать тест мне
              </button>
            </div>

            <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-[#3c4053]">
                  <CalendarClock className="size-4 text-[#5566f6]" /> Или запланировать, время московское
                </span>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3 text-[15px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                  data-testid="quick-schedule-at"
                />
              </label>
              <button
                type="button"
                className={cn(OUTLINE, "mt-2 w-full")}
                disabled={!canSend || !scheduledAt}
                onClick={() => setConfirm("schedule")}
                data-testid="quick-schedule"
              >
                <CalendarClock className="size-4 text-[#5566f6]" /> Запланировать
              </button>
            </div>

            {testResult ? <TestResult result={testResult} /> : null}
          </div>
        </section>

        <section className={CARD} data-testid="quick-preview">
          <div className={cn(SECTION_LABEL, "mb-3 flex items-center gap-2")}>
            <Eye className="size-4 text-[#5566f6]" /> Как выглядит письмо
          </div>
          {preset ? (
            <>
              {previewChannels.length > 1 ? (
                <div className="mb-3 flex flex-wrap gap-1">
                  {previewChannels.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setPreviewChannel(c)}
                      className={cn(
                        "inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium transition-colors",
                        previewChannel === c ? "bg-[#eef1ff] text-[#3848c7]" : "text-[#6f7282] hover:bg-[#f5f6ff]"
                      )}
                    >
                      {CHANNEL_LABELS[c]}
                    </button>
                  ))}
                </div>
              ) : null}
              <PreviewPane preview={preview} channel={previewChannel} />
            </>
          ) : (
            <p className="py-6 text-center text-[13px] text-[#9b9fb3]">Выберите письмо — оно появится здесь.</p>
          )}
        </section>
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle>Новая база адресов</DialogTitle>
            <DialogDescription>
              Вставьте адреса или загрузите CSV, назовите базу и укажите, на каком основании им можно писать. Адреса, которые
              уже есть в других базах, останутся там.
            </DialogDescription>
          </DialogHeader>
          <ImportCard
            variant="base"
            onImported={(r) => {
              setImportOpen(false);
              if (r.exists > 0) {
                toast.info(
                  `${r.exists} ${pluralRu(r.exists, "адрес уже был", "адреса уже были", "адресов уже были")} в других базах — они остались там`
                );
              }
              void reloadBases(r.created > 0 ? r.source : null);
            }}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => (confirm ? launch(confirm) : undefined)}
        variant="info"
        title={confirm === "schedule" ? "Запланировать рассылку?" : "Отправить рассылку сейчас?"}
        description={preset ? `«${preset.title}». После запуска письмо уже не поменять — только отменить отправку.` : undefined}
        bullets={[
          { label: `Базы: ${chosenBases.map((b) => b.title).join(", ")}` },
          { label: `Получат: ${reachable} ${pluralRu(reachable, "человек", "человека", "человек")}` },
          ...(confirm === "schedule" ? [{ label: `Старт: ${scheduledAt.replace("T", " ")} МСК`, tone: "info" as const }] : []),
          { label: "Отписавшиеся и адреса из стоп-листа пропускаются сами", tone: "info" as const },
        ]}
        confirmLabel={confirm === "schedule" ? "Запланировать" : "Отправить"}
      />
    </div>
  );
}

function StepTitle({ n, done, title, hint }: { n: number; done: boolean; title: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-2xl text-[15px] font-semibold tabular-nums",
          done ? "bg-[#5566f6] text-white" : "bg-[#eef1ff] text-[#3848c7]"
        )}
      >
        {done ? <Check className="size-4" /> : n}
      </span>
      <div className="min-w-0">
        <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">{title}</h2>
        {hint ? <p className="mt-0.5 text-[13px] text-[#6f7282]">{hint}</p> : null}
      </div>
    </div>
  );
}

function BaseCard({ base, checked, onChange }: { base: MailingBase; checked: boolean; onChange: (on: boolean) => void }) {
  const Icon = base.kind === "clients" ? Users : Mail;
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition-colors duration-150",
        checked ? "border-[#5566f6]/45 bg-[#f5f6ff]" : "border-[#ececf4] bg-white hover:border-[#5566f6]/30 hover:bg-[#fafbff]"
      )}
      data-testid={`quick-base-${base.id}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-4 shrink-0 cursor-pointer rounded border-[#dcdfed] accent-[#5566f6]"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[14.5px] font-semibold text-[#0b1024]">
          <Icon className="size-4 shrink-0 text-[#5566f6]" />
          <span className="truncate">{base.title}</span>
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-[1.5] text-[#6f7282]">{base.description}</span>
        <span className="mt-1.5 inline-flex rounded-full bg-[#eef1ff] px-2 py-0.5 text-[12px] font-medium tabular-nums text-[#3848c7]">
          {base.kind === "clients"
            ? `${base.total} ${pluralRu(base.total, "руководитель", "руководителя", "руководителей")} · с почтой ${base.emailable}`
            : `${base.emailable} ${pluralRu(base.emailable, "адрес", "адреса", "адресов")}`}
        </span>
      </span>
    </label>
  );
}

function Summary({
  ready,
  busy,
  error,
  stats,
  preset,
  chosen,
  reachable,
}: {
  ready: boolean;
  busy: boolean;
  error: string | null;
  stats: PlanStats | null;
  preset: MailingPreset | null;
  chosen: MailingBase[];
  reachable: number;
}) {
  if (!ready) {
    return (
      <p className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-5 text-center text-[13px] text-[#6f7282]">
        Выберите базу и письмо — здесь появится, сколько человек его получат.
      </p>
    );
  }
  if (error) {
    return (
      <Notice tone="danger" icon={<Info />}>
        {error}
      </Notice>
    );
  }
  if (!stats || busy) {
    return (
      <p className="flex items-center gap-2 py-3 text-[13px] text-[#6f7282]">
        <Loader2 className="size-4 animate-spin" /> Считаем получателей…
      </p>
    );
  }
  const e = stats.channels.email;
  const skipped = [
    e.suppressed ? `в стоп-листе ${e.suppressed}` : null,
    e.optedOut ? `отписались ${e.optedOut}` : null,
    e.noEmail ? `без почты ${e.noEmail}` : null,
  ].filter(Boolean);
  return (
    <div className="rounded-2xl bg-[#f5f6ff] px-4 py-3" data-testid="quick-summary">
      <div className="text-[13px] text-[#6f7282]">Получат письмо «{preset?.title}»</div>
      <div className="mt-0.5 text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024] tabular-nums">
        {reachable} {pluralRu(reachable, "человек", "человека", "человек")}
      </div>
      <ul className="mt-1.5 space-y-0.5 text-[13px] text-[#3c4053]">
        {preset?.channels.email ? (
          <li>
            Почта: {e.queued}
            {skipped.length ? <span className="text-[#6f7282]"> · не уйдёт: {skipped.join(", ")}</span> : null}
          </li>
        ) : null}
        {preset?.channels.inApp ? <li>Колокольчик в кабинете: {stats.channels.inApp.queued}</li> : null}
        {preset?.channels.telegram ? <li>Telegram: {stats.channels.telegram.queued}</li> : null}
        {preset?.channels.push ? <li>Push: {stats.channels.push.queued}</li> : null}
        {stats.duplicates > 0 ? (
          <li className="text-[#6f7282]">Совпали по почте и получат одно письмо: {stats.duplicates}</li>
        ) : null}
        {stats.notApplicable > 0 ? (
          <li className="text-[#6f7282]">Загруженным адресам уходит только почта: {stats.notApplicable}</li>
        ) : null}
      </ul>
      {reachable === 0 ? (
        <p className="mt-2 text-[13px] text-[#a13a32]">
          В {chosen.length > 1 ? "выбранных базах" : "этой базе"} некому отправить это письмо.
        </p>
      ) : null}
    </div>
  );
}

function TestResult({ result }: { result: TestSendResult }) {
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-white p-3" data-testid="quick-test-result">
      <div className="mb-2 text-[13px] font-semibold text-[#0b1024]">
        Тест {result.email ? `на ${result.email}` : "(у вас нет почты)"}
      </div>
      <ul className="space-y-1.5">
        {MAILING_CHANNELS.filter((c) => result.channels[c]).map((c) => {
          const r = result.channels[c]!;
          const Icon = CHANNEL_ICONS[c];
          return (
            <li key={c} className="flex items-start gap-2 text-[13px]">
              <Icon className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
              <span>
                <b>{CHANNEL_LABELS[c]}:</b> {CHANNEL_STATUS_LABELS[r.status]}
                {r.dryRun ? " (сухая отправка)" : ""}
                {r.error ? ` — ${r.error}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
