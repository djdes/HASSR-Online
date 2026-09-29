"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Eye,
  FlaskConical,
  Info,
  Loader2,
  Save,
  Send,
  ShieldAlert,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { MailingKindFields } from "@/components/mailing/kind-fields";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { PlanStats } from "@/lib/mailing/audience.server";
import type { TestSendResult } from "@/lib/mailing/campaigns.server";
import {
  CHANNEL_LABELS,
  CHANNEL_STATUS_LABELS,
  MAILING_CHANNELS,
  anyChannel,
  type MailingChannel,
  type MailingChannels,
} from "@/lib/mailing/labels";
import type { RenderedMailing } from "@/lib/mailing/templates";
import { pluralRu } from "@/lib/plural-ru";
import { cn } from "@/lib/utils";

import { CARD, CHANNEL_ICONS, CHECKBOX, INPUT, Notice, OUTLINE, PRIMARY, SECTION_LABEL, api } from "./ui";
import type { MailingPageData, MailingTab } from "./types";

type PreviewState = { label: string; rendered: RenderedMailing } | { error: string } | null;

export function ComposeTab({
  data,
  draftId,
  title,
  onTitle,
  kind,
  onKind,
  channels,
  onChannels,
  payload,
  onPayload,
  userIds,
  contactIds,
  labels,
  saving,
  savedAt,
  onSave,
  onLaunched,
  goTo,
}: {
  data: MailingPageData;
  draftId: string | null;
  title: string;
  onTitle: (v: string) => void;
  kind: string;
  onKind: (v: string) => void;
  channels: MailingChannels;
  onChannels: (v: MailingChannels) => void;
  payload: unknown;
  onPayload: (v: unknown) => void;
  userIds: ReadonlySet<string>;
  contactIds: ReadonlySet<string>;
  labels: ReadonlyMap<string, string>;
  saving: boolean;
  savedAt: string | null;
  onSave: () => Promise<string | null>;
  onLaunched: (campaignId: string) => void;
  goTo: (tab: MailingTab) => void;
}) {
  const [reach, setReach] = useState<PlanStats | null>(null);
  const [reachBusy, setReachBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewTab, setPreviewTab] = useState<MailingChannel>("email");
  const [previewFor, setPreviewFor] = useState<string>("sample");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<TestSendResult | null>(null);
  const [confirm, setConfirm] = useState<"now" | "schedule" | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");

  const selectionKey = `${[...userIds].sort().join(",")}|${[...contactIds].sort().join(",")}`;
  const selectedTotal = userIds.size + contactIds.size;

  // Охват по каналам — пересчёт при изменении выбора.
  useEffect(() => {
    if (selectedTotal === 0) {
      setReach(null);
      return;
    }
    let alive = true;
    setReachBusy(true);
    const t = setTimeout(() => {
      api<{ stats: PlanStats }>("/api/root/mailing/reach", {
        method: "POST",
        json: { userIds: [...userIds], contactIds: [...contactIds] },
      })
        .then((r) => alive && setReach(r.stats))
        .catch((error) => toast.error(error instanceof Error ? error.message : "Не удалось посчитать охват"))
        .finally(() => alive && setReachBusy(false));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  const recipientOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [{ value: "sample", label: "Пример: Иван Петров, Кафе «Ромашка»" }];
    for (const id of [...userIds].slice(0, 30)) {
      const label = labels.get(`user:${id}`);
      if (label) opts.push({ value: `user:${id}`, label });
    }
    for (const id of [...contactIds].slice(0, 30)) {
      const label = labels.get(`contact:${id}`);
      if (label) opts.push({ value: `contact:${id}`, label });
    }
    return opts;
  }, [userIds, contactIds, labels]);

  // Предпросмотр — с паузой после ввода.
  const payloadKey = JSON.stringify(payload);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      setPreviewBusy(true);
      const [type, id] = previewFor === "sample" ? [null, null] : previewFor.split(":");
      api<{ label: string; rendered: RenderedMailing }>("/api/root/mailing/preview", {
        method: "POST",
        json: { kind, payload, recipient: type && id ? { type, id } : null },
      })
        .then((r) => alive && setPreview(r))
        .catch((error) => alive && setPreview({ error: error instanceof Error ? error.message : "Нет предпросмотра" }))
        .finally(() => alive && setPreviewBusy(false));
    }, 600);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey, kind, previewFor]);

  const emailQueued = reach?.channels.email.queued ?? 0;
  const leftToday = Math.max(0, data.settings.perDay - data.sentToday);
  const minutes = channels.email && emailQueued > 0 ? Math.ceil(Math.min(emailQueued, leftToday) / data.settings.perMinute) : 0;

  async function runTest() {
    setTestBusy(true);
    setTestResult(null);
    try {
      const id = await onSave();
      if (!id) return;
      const r = await api<TestSendResult>(`/api/root/mailing/campaigns/${id}/test`, { method: "POST" });
      setTestResult(r);
      toast.success("Тестовая отправка выполнена — результат ниже");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Тест не удался");
    } finally {
      setTestBusy(false);
    }
  }

  async function launch(mode: "now" | "schedule") {
    const id = await onSave();
    if (!id) return;
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
      onLaunched(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось запустить");
      throw error;
    }
  }

  const noRecipients = selectedTotal === 0;
  // Охват считается сразу по всем каналам; контактам нужен канал «Почта».
  const recipientsCount = reach ? reach.users + (channels.email ? reach.contacts : 0) : null;
  const kindLabel = data.kinds.find((k) => k.kind === kind)?.label ?? kind;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]" data-testid="mailing-compose-tab">
      <div className="min-w-0 space-y-5">
        <section className={CARD}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
                <Users className="size-5" />
              </span>
              <div>
                <div className="text-[16px] font-semibold text-[#0b1024]" data-testid="compose-recipients">
                  {noRecipients
                    ? "Получатели не выбраны"
                    : recipientsCount !== null
                      ? `Получателей: ${recipientsCount}`
                      : `Выбрано: ${selectedTotal}`}
                </div>
                <div className="text-[13px] text-[#6f7282]">
                  выбрано пользователей {userIds.size} · контактов {contactIds.size}
                  {reach && reach.duplicates > 0 ? ` · совпали по почте и считаются один раз: ${reach.duplicates}` : ""}
                  {reach && reach.missing > 0 ? ` · не найдены (удалены или отключены): ${reach.missing}` : ""}
                  {reach && reach.contacts > 0 && !channels.email ? " · контактам письмо не уйдёт: не отмечена «Почта»" : ""}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={OUTLINE} onClick={() => goTo("users")}>
                Пользователи
              </button>
              <button type="button" className={OUTLINE} onClick={() => goTo("contacts")}>
                Контакты
              </button>
            </div>
          </div>
        </section>

        <section className={CARD}>
          <div className={cn(SECTION_LABEL, "mb-4")}>Сообщение</div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Название для себя</span>
              <input
                value={title}
                onChange={(e) => onTitle(e.target.value)}
                placeholder="Например: новости сентября для кафе"
                maxLength={120}
                className={INPUT}
                data-testid="compose-title"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Тип</span>
              <select
                value={kind}
                onChange={(e) => onKind(e.target.value)}
                className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3 text-[15px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                data-testid="compose-kind"
              >
                {data.kinds.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4">
            <MailingKindFields
              kind={kind}
              payload={payload}
              onChange={onPayload}
              audience={{ users: userIds.size, contacts: contactIds.size }}
              formData={data.kinds.find((k) => k.kind === kind)?.formData ?? null}
            />
          </div>
        </section>

        <section className={CARD} data-testid="compose-channels">
          <div className={cn(SECTION_LABEL, "mb-1")}>Каналы</div>
          <p className="mb-4 text-[13px] text-[#6f7282]">
            Отметьте, куда отправить. Рядом — сколько выбранных реально получат.
            {reachBusy ? " Считаем…" : ""}
          </p>
          <div className="space-y-2">
            {MAILING_CHANNELS.map((c) => (
              <ChannelRow
                key={c}
                channel={c}
                checked={channels[c]}
                onChange={(on) => onChannels({ ...channels, [c]: on })}
                reach={reach}
                data={data}
                selectedUsers={userIds.size}
                selectedContacts={contactIds.size}
              />
            ))}
          </div>
        </section>
      </div>

      <div className="min-w-0 space-y-5 xl:sticky xl:top-6 xl:self-start">
        <section className={CARD} data-testid="compose-actions">
          <div className={cn(SECTION_LABEL, "mb-3")}>Отправка</div>
          <div className="space-y-3">
            {!data.sender.separateSender ? (
              <Notice tone="warn" icon={<ShieldAlert />} testId="sender-warning">
                Рекламные письма уходят с {data.sender.fromAddress} — если их пометят спамом, служебные письма (коды
                входа, счета) тоже начнут попадать в спам. Лучше отдельный адрес/домен.
              </Notice>
            ) : null}
            {data.sender.mode === "dry-run-dir" || data.sender.mode === "log-only" ? (
              <Notice tone="info" icon={<Info />} testId="dry-run-notice">
                Сухая отправка:{" "}
                {data.sender.mode === "dry-run-dir"
                  ? `письма, push и Telegram пишутся файлами в ${data.sender.dryRunDir}`
                  : "SMTP не настроен — письма только в логе сервера"}
                . Наружу ничего не уходит.
              </Notice>
            ) : null}
            <p className="text-[13px] leading-[1.55] text-[#6f7282]" data-testid="rate-limit-line">
              Скорость: до {data.settings.perMinute} писем в минуту и {data.settings.perDay} в сутки. Сегодня уже ушло{" "}
              {data.sentToday}.
              {channels.email && emailQueued > 0
                ? ` Этой рассылке — ${emailQueued} ${pluralRu(emailQueued, "письмо", "письма", "писем")}: около ${minutes} мин.${
                    emailQueued > leftToday ? " Часть уйдёт завтра — сработает суточный лимит." : ""
                  }`
                : ""}
            </p>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <button
                type="button"
                className={PRIMARY}
                disabled={noRecipients || !anyChannel(channels) || saving}
                onClick={() => setConfirm("now")}
                data-testid="compose-send-now"
              >
                <Send className="size-4" /> Отправить сейчас
              </button>
              <button
                type="button"
                className={OUTLINE}
                disabled={!anyChannel(channels) || testBusy || saving}
                onClick={() => void runTest()}
                data-testid="compose-test"
              >
                {testBusy ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4 text-[#5566f6]" />}
                Тестовая отправка мне
              </button>
            </div>

            <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-[#3c4053]">
                  <CalendarClock className="size-4 text-[#5566f6]" /> Запланировать, время московское
                </span>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3 text-[15px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                  data-testid="compose-schedule-at"
                />
              </label>
              <button
                type="button"
                className={cn(OUTLINE, "mt-2 w-full")}
                disabled={noRecipients || !anyChannel(channels) || !scheduledAt || saving}
                onClick={() => setConfirm("schedule")}
                data-testid="compose-schedule"
              >
                <CalendarClock className="size-4 text-[#5566f6]" /> Запланировать
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                className={OUTLINE}
                disabled={saving}
                onClick={() => void onSave()}
                data-testid="compose-save"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4 text-[#5566f6]" />}
                Сохранить черновик
              </button>
              <span className="text-[12px] text-[#9b9fb3]" data-testid="compose-saved">
                {savedAt ? `Черновик сохранён в ${savedAt}` : draftId ? "Черновик" : "Ещё не сохранён"}
              </span>
            </div>

            {testResult ? (
              <div className="rounded-2xl border border-[#ececf4] bg-white p-3" data-testid="compose-test-result">
                <div className="mb-2 text-[13px] font-semibold text-[#0b1024]">
                  Тест {testResult.email ? `на ${testResult.email}` : "(почты нет)"}
                </div>
                <ul className="space-y-1.5">
                  {MAILING_CHANNELS.filter((c) => testResult.channels[c]).map((c) => {
                    const r = testResult.channels[c]!;
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
                {testResult.notes && testResult.notes.length > 0 ? (
                  <p className="mt-2 text-[12.5px] leading-[1.5] text-[#7a4a00]" data-testid="compose-test-notes">
                    {testResult.notes.join(" ")} Эта пометка есть и в самом тестовом письме.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        <section className={CARD} data-testid="compose-preview">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className={cn(SECTION_LABEL, "flex items-center gap-2")}>
              <Eye className="size-4 text-[#5566f6]" /> Предпросмотр
            </div>
            {previewBusy ? <Loader2 className="size-4 animate-spin text-[#9b9fb3]" /> : null}
          </div>
          <select
            value={previewFor}
            onChange={(e) => setPreviewFor(e.target.value)}
            className="mb-3 h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-2 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
            aria-label="Для кого предпросмотр"
            data-testid="compose-preview-for"
          >
            {recipientOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="mb-3 flex flex-wrap gap-1">
            {MAILING_CHANNELS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setPreviewTab(c)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium transition-colors",
                  previewTab === c ? "bg-[#eef1ff] text-[#3848c7]" : "text-[#6f7282] hover:bg-[#f5f6ff]"
                )}
              >
                {CHANNEL_LABELS[c]}
              </button>
            ))}
          </div>
          <PreviewPane preview={preview} channel={previewTab} />
        </section>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => (confirm ? launch(confirm) : undefined)}
        variant="info"
        title={confirm === "schedule" ? "Запланировать рассылку?" : "Отправить рассылку сейчас?"}
        description={`«${title || "Без названия"}» · ${kindLabel}. После запуска текст менять нельзя — только отменить.`}
        bullets={[
          {
            label: `Получателей: ${recipientsCount ?? selectedTotal}${reach && reach.duplicates ? ` (совпали по почте: ${reach.duplicates})` : ""}`,
          },
          {
            label: `Каналы: ${MAILING_CHANNELS.filter((c) => channels[c]).map((c) => CHANNEL_LABELS[c]).join(", ")}`,
          },
          ...(channels.email
            ? [
                {
                  label: `Письма уходят по ${data.settings.perMinute} в минуту, не больше ${data.settings.perDay} в сутки — адреса из стоп-листа пропускаются`,
                  tone: "info" as const,
                },
              ]
            : []),
          ...(confirm === "schedule" ? [{ label: `Старт: ${scheduledAt.replace("T", " ")} МСК`, tone: "info" as const }] : []),
          ...(!data.sender.separateSender && channels.email
            ? [{ label: "Письма идут с основного адреса сервиса", tone: "warn" as const }]
            : []),
        ]}
        confirmLabel={confirm === "schedule" ? "Запланировать" : "Отправить"}
      />
    </div>
  );
}

function ChannelRow({
  channel,
  checked,
  onChange,
  reach,
  data,
  selectedUsers,
  selectedContacts,
}: {
  channel: MailingChannel;
  checked: boolean;
  onChange: (on: boolean) => void;
  reach: PlanStats | null;
  data: MailingPageData;
  selectedUsers: number;
  selectedContacts: number;
}) {
  const Icon = CHANNEL_ICONS[channel];
  let line: string;
  let warn: string | null = null;
  if (!reach) {
    line = selectedUsers + selectedContacts === 0 ? "Сначала выберите получателей" : "Считаем…";
  } else if (channel === "email") {
    const e = reach.channels.email;
    const total = reach.users + reach.contacts;
    line = `Дойдёт до ${e.queued} из ${total}`;
    const parts = [
      e.noEmail ? `без почты ${e.noEmail}` : null,
      e.suppressed ? `в стоп-листе ${e.suppressed}` : null,
      e.optedOut ? `отписались ${e.optedOut}` : null,
      e.inactiveContact ? `контакт не активен ${e.inactiveContact}` : null,
    ].filter(Boolean);
    if (parts.length) line += ` · ${parts.join(", ")}`;
  } else if (channel === "inApp") {
    line = `Дойдёт до ${reach.channels.inApp.queued} — только пользователи${selectedContacts ? `, контакты (${reach.contacts}) не получат` : ""}`;
  } else if (channel === "push") {
    const p = reach.channels.push;
    line = `Дойдёт до ${p.queued} из ${reach.users} · веб-push подключён у ${p.webSubs}, приложение у ${p.appDevices}`;
    if (!p.appConfigured) warn = "Firebase не настроен — в приложение push не уходит";
    if (!p.webConfigured) warn = [warn, "веб-push на сервере не настроен"].filter(Boolean).join("; ");
  } else {
    const t = reach.channels.telegram;
    line = `Дойдёт до ${t.queued} из ${reach.users} — у кого привязан бот`;
    if (!t.botConfigured) warn = "Бот Telegram не настроен на сервере";
  }
  const ok = !reach || (channel === "email" ? reach.channels.email.queued : channel === "inApp" ? reach.channels.inApp.queued : channel === "push" ? reach.channels.push.queued : reach.channels.telegram.queued) > 0;
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition-colors",
        checked ? "border-[#5566f6]/35 bg-[#f5f6ff]" : "border-[#ececf4] bg-white hover:bg-[#fafbff]"
      )}
      data-testid={`channel-${channel}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={cn(CHECKBOX, "mt-1")}
      />
      <Icon className="mt-0.5 size-5 shrink-0 text-[#5566f6]" />
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-[#0b1024]">{CHANNEL_LABELS[channel]}</span>
        <span className={cn("block text-[13px]", ok ? "text-[#6f7282]" : "text-[#a16d32]")} data-testid={`channel-${channel}-reach`}>
          {line}
        </span>
        {warn ? (
          <span className="mt-1 flex items-start gap-1.5 text-[12px] text-[#a16d32]">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {warn}
          </span>
        ) : null}
        {channel === "email" && data.sender.mode !== "marketing-smtp" && data.sender.mode !== "main-smtp" ? (
          <span className="mt-1 block text-[12px] text-[#3848c7]">Сухая отправка — наружу не уйдёт</span>
        ) : null}
      </span>
    </label>
  );
}

function PreviewPane({ preview, channel }: { preview: PreviewState; channel: MailingChannel }) {
  if (!preview) {
    return <p className="py-6 text-center text-[13px] text-[#9b9fb3]">Готовим предпросмотр…</p>;
  }
  if ("error" in preview) {
    return (
      <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-8 text-center text-[13px] text-[#6f7282]">
        {preview.error}
      </div>
    );
  }
  const r = preview.rendered;
  return (
    <div data-testid={`preview-${channel}`}>
      <div className="mb-2 text-[12px] text-[#9b9fb3]">Для: {preview.label}</div>
      {r.notes && r.notes.length > 0 ? (
        <div
          className="mb-2 flex items-start gap-2 rounded-xl bg-[#fff8eb] px-3 py-2 text-[12.5px] leading-[1.5] text-[#7a4a00]"
          data-testid="preview-notes"
        >
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>{r.notes.join(" ")}</span>
        </div>
      ) : null}
      {channel === "email" ? (
        r.email ? (
          <div className="overflow-hidden rounded-2xl border border-[#ececf4]">
            <div className="border-b border-[#ececf4] bg-[#fafbff] px-3 py-2 text-[13px]">
              <div className="font-semibold text-[#0b1024] [overflow-wrap:anywhere]">{r.email.subject}</div>
              {r.email.preheader ? <div className="truncate text-[#9b9fb3]">{r.email.preheader}</div> : null}
            </div>
            <iframe
              title="Письмо"
              srcDoc={r.email.html}
              sandbox=""
              className="h-[480px] w-full bg-white"
            />
          </div>
        ) : (
          <p className="text-[13px] text-[#9b9fb3]">Этот тип не отправляет письма.</p>
        )
      ) : channel === "inApp" ? (
        r.inApp ? (
          <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
            <div className="text-[14px] font-medium text-[#0b1024]">{r.inApp.title}</div>
            <div className="mt-2 rounded-xl border border-[#ececf4] bg-white px-3 py-2 text-[14px] text-[#3c4053]">
              {r.inApp.body}
            </div>
            {r.inApp.url ? <div className="mt-2 text-[13px] text-[#3848c7]">Открыть → {r.inApp.url}</div> : null}
          </div>
        ) : (
          <p className="text-[13px] text-[#9b9fb3]">Этот тип не пишет в колокольчик.</p>
        )
      ) : channel === "push" ? (
        r.push ? (
          <div className="rounded-2xl bg-[#0b1024] p-3 text-white">
            <div className="text-[12px] text-white/60">WeSetup · сейчас</div>
            <div className="mt-1 text-[14px] font-semibold">{r.push.title}</div>
            <div className="mt-0.5 text-[13px] text-white/80">{r.push.body}</div>
          </div>
        ) : (
          <p className="text-[13px] text-[#9b9fb3]">Этот тип не отправляет push.</p>
        )
      ) : r.telegram ? (
        <div className="rounded-2xl bg-[#e7ebf0] p-3">
          <div
            className="max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-tl-md bg-white px-3 py-2 text-[14px] leading-[1.5] text-[#0b1024] [overflow-wrap:anywhere] [&_a]:text-[#3848c7] [&_a]:underline"
            // Текст собран сервером из экранированного ввода ROOT (<b>, <a>).
            dangerouslySetInnerHTML={{ __html: r.telegram.text }}
          />
        </div>
      ) : (
        <p className="text-[13px] text-[#9b9fb3]">Этот тип не отправляет в Telegram.</p>
      )}
    </div>
  );
}
