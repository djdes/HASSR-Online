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
import { useTranslations } from "next-intl";
import { useSiteLocale } from "@/components/i18n/site-locale-provider";
import { composeCount, composeDiagnosticText, composeError, composeKindKey, composePreviewRecipient, composeStatusKey, type ComposeErrorEvent } from "@/lib/mailing/compose-presentation";
import { useComposeFeedback } from "./compose-feedback";

import { MailingKindFields } from "@/components/mailing/kind-fields";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { PlanStats } from "@/lib/mailing/audience.server";
import type { TestSendResult } from "@/lib/mailing/campaigns.server";
import {
  MAILING_CHANNELS,
  anyChannel,
  type MailingChannel,
  type MailingChannels,
} from "@/lib/mailing/labels";
import type { RenderedMailing } from "@/lib/mailing/templates";
import { cn } from "@/lib/utils";

import { CARD, CHANNEL_ICONS, CHECKBOX, INPUT, Notice, OUTLINE, PRIMARY, SECTION_LABEL, api } from "./ui";
import type { MailingPageData, MailingTab } from "./types";

export type PreviewState = { label: string; rendered: RenderedMailing; recipientPresentation?: unknown } | { failure: ComposeErrorEvent } | { error: string } | null;

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
  const t = useTranslations("rootMailingCompose");
  const shell = useTranslations("rootMailingShellAudience");
  const locale = useSiteLocale();
  const feedback = useComposeFeedback();
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
        .catch((error) => feedback.error(composeError("reachFailed", error)))
        .finally(() => alive && setReachBusy(false));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  const recipientOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string }> = [{ value: "sample", label: t("preview.sampleOption", { name: "Иван Петров", companyName: "Кафе «Ромашка»" }) }];
    for (const id of [...userIds].slice(0, 30)) {
      const label = labels.get(`user:${id}`);
      if (label) opts.push({ value: `user:${id}`, label });
    }
    for (const id of [...contactIds].slice(0, 30)) {
      const label = labels.get(`contact:${id}`);
      if (label) opts.push({ value: `contact:${id}`, label });
    }
    return opts;
  }, [userIds, contactIds, labels, t]);

  // Предпросмотр — с паузой после ввода.
  const payloadKey = JSON.stringify(payload);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      setPreviewBusy(true);
      const [type, id] = previewFor === "sample" ? [null, null] : previewFor.split(":");
      api<{ label: string; rendered: RenderedMailing; recipientPresentation?: unknown }>("/api/root/mailing/preview", {
        method: "POST",
        json: { kind, payload, recipient: type && id ? { type, id } : null },
      })
        .then((r) => alive && setPreview(r))
        .catch((error) => alive && setPreview({ failure: composeError("previewFailed", error) }))
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
      feedback.success({ key: "testSucceeded" });
    } catch (error) {
      feedback.error(composeError("testFailed", error));
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
      feedback.success(
        mode === "now"
          ? { key: "launched", count: r.stats.recipients }
          : { key: "scheduled", at: scheduledAt.replace("T", " ") }
      );
      setConfirm(null);
      onLaunched(id);
    } catch (error) {
      feedback.error(composeError("launchFailed", error));
      throw error;
    }
  }

  const noRecipients = selectedTotal === 0;
  // Охват считается сразу по всем каналам; контактам нужен канал «Почта».
  const recipientsCount = reach ? reach.users + (channels.email ? reach.contacts : 0) : null;
  const kindKey = composeKindKey(kind);
  const kindLabel = kindKey ? t(kindKey) : data.kinds.find((k) => k.kind === kind)?.label ?? kind;

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
                  {t("recipients.title", { state: noRecipients ? "empty" : recipientsCount !== null ? "reach" : "selected", count: String(recipientsCount !== null ? recipientsCount : selectedTotal) })}
                </div>
                <div className="text-[13px] text-[#6f7282]">
                  {t("recipients.summary", { users: String(userIds.size), contacts: String(contactIds.size), duplicates: reach && reach.duplicates > 0 ? "yes" : "no", duplicateCount: String(reach?.duplicates), missing: reach && reach.missing > 0 ? "yes" : "no", missingCount: String(reach?.missing), excluded: reach && reach.contacts > 0 && !channels.email ? "yes" : "no" })}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={OUTLINE} onClick={() => goTo("users")}>
                {shell("tabs.users")}
              </button>
              <button type="button" className={OUTLINE} onClick={() => goTo("contacts")}>
                {shell("tabs.contacts")}
              </button>
            </div>
          </div>
        </section>

        <section className={CARD}>
          <div className={cn(SECTION_LABEL, "mb-4")}>{t("message.heading")}</div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("message.titleLabel")}</span>
              <input
                value={title}
                onChange={(e) => onTitle(e.target.value)}
                placeholder={t("message.titleExample")}
                maxLength={120}
                className={INPUT}
                data-testid="compose-title"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{t("message.kindLabel")}</span>
              <select
                value={kind}
                onChange={(e) => onKind(e.target.value)}
                className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-3 text-[15px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                data-testid="compose-kind"
              >
                {data.kinds.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {composeKindKey(k.kind) ? t(composeKindKey(k.kind)!) : k.label}
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
          <div className={cn(SECTION_LABEL, "mb-1")}>{t("channels.heading")}</div>
          <p className="mb-4 text-[13px] text-[#6f7282]">
            {t("channels.hint", { busy: reachBusy ? "yes" : "no" })}
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
          <div className={cn(SECTION_LABEL, "mb-3")}>{t("send.heading")}</div>
          <div className="space-y-3">
            {!data.sender.separateSender ? (
              <Notice tone="warn" icon={<ShieldAlert />} testId="sender-warning">
                {t.rich("send.senderWarning", { address: () => <>{data.sender.fromAddress}</> })}
              </Notice>
            ) : null}
            {data.sender.mode === "dry-run-dir" || data.sender.mode === "log-only" ? (
              <Notice tone="info" icon={<Info />} testId="dry-run-notice">
                {t("send.dryRunNotice", { mode: data.sender.mode === "dry-run-dir" ? "files" : "log", directory: String(data.sender.dryRunDir) })}
              </Notice>
            ) : null}
            <p className="text-[13px] leading-[1.55] text-[#6f7282]" data-testid="rate-limit-line">
              {t.rich("send.rateLine", { perMinute: () => <>{data.settings.perMinute}</>, perDay: () => <>{data.settings.perDay}</>, sentToday: () => <>{data.sentToday}</>, queued: channels.email && emailQueued > 0 ? "yes" : "no", ...composeCount(emailQueued, locale), minutes: String(minutes), overflow: emailQueued > leftToday ? "yes" : "no" })}
            </p>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <button
                type="button"
                className={PRIMARY}
                disabled={noRecipients || !anyChannel(channels) || saving}
                onClick={() => setConfirm("now")}
                data-testid="compose-send-now"
              >
                <Send className="size-4" /> {t("send.now")}
              </button>
              <button
                type="button"
                className={OUTLINE}
                disabled={!anyChannel(channels) || testBusy || saving}
                onClick={() => void runTest()}
                data-testid="compose-test"
              >
                {testBusy ? <Loader2 className="size-4 animate-spin" /> : <FlaskConical className="size-4 text-[#5566f6]" />}
                {t("send.test")}
              </button>
            </div>

            <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-[#3c4053]">
                  <CalendarClock className="size-4 text-[#5566f6]" /> {t("send.scheduleTime")}
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
                <CalendarClock className="size-4 text-[#5566f6]" /> {t("send.schedule")}
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
                {t("send.save")}
              </button>
              <span className="text-[12px] text-[#9b9fb3]" data-testid="compose-saved">
                {t("send.saveState", { state: savedAt ? "saved" : draftId ? "draft" : "new", at: String(savedAt) })}
              </span>
            </div>

            {testResult ? (
              <div className="rounded-2xl border border-[#ececf4] bg-white p-3" data-testid="compose-test-result">
                <div className="mb-2 text-[13px] font-semibold text-[#0b1024]">
                  {t("test.heading", { email: testResult.email ? "present" : "none", address: String(testResult.email) })}
                </div>
                <ul className="space-y-1.5">
                  {MAILING_CHANNELS.filter((c) => testResult.channels[c]).map((c) => {
                    const r = testResult.channels[c]!;
                    const Icon = CHANNEL_ICONS[c];
                    const statusKey = composeStatusKey(r.status);
                    return (
                      <li key={c} className="flex items-start gap-2 text-[13px]">
                        <Icon className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
                        <span>
                          <b>{t(`channels.label.${c}`)}:</b> {t.rich("test.channelResult", { status: () => <>{statusKey ? t(statusKey) : r.status}</>, dryRun: r.dryRun ? "yes" : "no" })}
                          {r.error ? <> — {t("diagnostics.originalTechnical", { detail: String(r.error) })}</> : ""}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {testResult.notes && testResult.notes.length > 0 ? (
                  <p className="mt-2 text-[12.5px] leading-[1.5] text-[#7a4a00]" data-testid="compose-test-notes">
                    {t("diagnostics.originalTemplate", { notes: testResult.notes.join(" ") })}{t("test.notesFooter")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        <section className={CARD} data-testid="compose-preview">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className={cn(SECTION_LABEL, "flex items-center gap-2")}>
              <Eye className="size-4 text-[#5566f6]" /> {t("preview.title")}
            </div>
            {previewBusy ? <Loader2 className="size-4 animate-spin text-[#9b9fb3]" /> : null}
          </div>
          <select
            value={previewFor}
            onChange={(e) => setPreviewFor(e.target.value)}
            className="mb-3 h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-2 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
            aria-label={t("preview.forAria")}
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
                {t(`channels.label.${c}`)}
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
        title={confirm === "schedule" ? t("confirm.scheduleTitle") : t("confirm.nowTitle")}
        description={t("confirm.description", { title: title || t("confirm.untitled"), kind: kindLabel })}
        bullets={[
          {
            label: t("confirm.recipients", { count: String(recipientsCount ?? selectedTotal), duplicates: reach && reach.duplicates ? "yes" : "no", duplicateCount: String(reach?.duplicates) }),
          },
          {
            label: t("confirm.channels", { channels: MAILING_CHANNELS.filter((c) => channels[c]).map((c) => t(`channels.label.${c}`)).join(", ") }),
          },
          ...(channels.email
            ? [
                {
                  label: t("confirm.rate", { perMinute: String(data.settings.perMinute), perDay: String(data.settings.perDay) }),
                  tone: "info" as const,
                },
              ]
            : []),
          ...(confirm === "schedule" ? [{ label: t("confirm.start", { at: scheduledAt.replace("T", " ") }), tone: "info" as const }] : []),
          ...(!data.sender.separateSender && channels.email
            ? [{ label: t("confirm.mainSender"), tone: "warn" as const }]
            : []),
        ]}
        confirmLabel={confirm === "schedule" ? t("send.schedule") : t("confirm.send")}
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
  const t = useTranslations("rootMailingCompose");
  const Icon = CHANNEL_ICONS[channel];
  let line: string;
  let warn: string | null = null;
  if (!reach) {
    line = selectedUsers + selectedContacts === 0 ? t("channels.reachNone") : t("channels.reachCounting");
  } else if (channel === "email") {
    const e = reach.channels.email;
    const total = reach.users + reach.contacts;
    line = t("channels.reachEmail", { queued: String(e.queued), total: String(total), noEmail: e.noEmail ? "yes" : "no", noEmailCount: String(e.noEmail), suppressed: e.suppressed ? "yes" : "no", suppressedCount: String(e.suppressed), optedOut: e.optedOut ? "yes" : "no", optedOutCount: String(e.optedOut), priorOptedOut: e.noEmail || e.suppressed ? "yes" : "no", inactive: e.inactiveContact ? "yes" : "no", inactiveCount: String(e.inactiveContact), priorInactive: e.noEmail || e.suppressed || e.optedOut ? "yes" : "no" });
  } else if (channel === "inApp") {
    line = t("channels.reachInApp", { queued: String(reach.channels.inApp.queued), contacts: selectedContacts ? "yes" : "no", contactCount: String(reach.contacts), optedOut: reach.channels.inApp.optedOut ? "yes" : "no", optedOutCount: String(reach.channels.inApp.optedOut) });
  } else if (channel === "push") {
    const p = reach.channels.push;
    line = t("channels.reachPush", { queued: String(p.queued), users: String(reach.users), webSubs: String(p.webSubs), appDevices: String(p.appDevices), optedOut: p.optedOut ? "yes" : "no", optedOutCount: String(p.optedOut) });
    if (!p.appConfigured || !p.webConfigured) warn = t("channels.pushWarning", { app: p.appConfigured ? "ready" : "missing", web: p.webConfigured ? "ready" : "missing" });
  } else {
    const telegram = reach.channels.telegram;
    line = t("channels.reachTelegram", { queued: String(telegram.queued), users: String(reach.users), optedOut: telegram.optedOut ? "yes" : "no", optedOutCount: String(telegram.optedOut) });
    if (!telegram.botConfigured) warn = t("channels.telegramWarning");
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
        <span className="block text-[15px] font-medium text-[#0b1024]">{t(`channels.label.${channel}`)}</span>
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
          <span className="mt-1 block text-[12px] text-[#3848c7]">{t("channels.dryRun")}</span>
        ) : null}
      </span>
    </label>
  );
}

export function PreviewPane({ preview, channel }: { preview: PreviewState; channel: MailingChannel }) {
  const t = useTranslations("rootMailingCompose");
  const diagnostics = useTranslations("rootMailingDiagnostics");
  const locale = useSiteLocale();
  if (!preview) {
    return <p className="py-6 text-center text-[13px] text-[#9b9fb3]">{t("preview.loading")}</p>;
  }
  if ("failure" in preview) {
    return (
      <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-8 text-center text-[13px] text-[#6f7282]">
        {t(`feedback.${preview.failure.key}`)}
        {preview.failure.detail !== undefined ? <span className="block">{composeDiagnosticText(preview.failure.presentation, locale, diagnostics) ?? t("diagnostics.originalTechnical", { detail: preview.failure.detail })}</span> : null}
      </div>
    );
  }
  if ("error" in preview) {
    return (
      <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-8 text-center text-[13px] text-[#6f7282]">
        {preview.error}
      </div>
    );
  }
  const r = preview.rendered;
  const recipient = composePreviewRecipient(preview.recipientPresentation);
  return (
    <div data-testid={`preview-${channel}`}>
      <div className="mb-2 text-[12px] text-[#9b9fb3]">{recipient?.kind === "sample" ? t("preview.forSample", { name: recipient.name, companyName: recipient.companyName }) : t.rich("preview.forRecipient", { recipient: () => <>{preview.label}</> })}</div>
      {r.notes && r.notes.length > 0 ? (
        <div
          className="mb-2 flex items-start gap-2 rounded-xl bg-[#fff8eb] px-3 py-2 text-[12.5px] leading-[1.5] text-[#7a4a00]"
          data-testid="preview-notes"
        >
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>{t("diagnostics.originalTemplate", { notes: r.notes.join(" ") })}</span>
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
              title={t("preview.iframeTitle")}
              srcDoc={r.email.html}
              sandbox=""
              className="h-[480px] w-full bg-white"
            />
          </div>
        ) : (
          <p className="text-[13px] text-[#9b9fb3]">{t("preview.emptyEmail")}</p>
        )
      ) : channel === "inApp" ? (
        r.inApp ? (
          <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
            <div className="text-[14px] font-medium text-[#0b1024]">{r.inApp.title}</div>
            <div className="mt-2 rounded-xl border border-[#ececf4] bg-white px-3 py-2 text-[14px] text-[#3c4053]">
              {r.inApp.body}
            </div>
            {r.inApp.url ? <div className="mt-2 text-[13px] text-[#3848c7]">{t.rich("preview.openLink", { url: () => <>{r.inApp?.url}</> })}</div> : null}
          </div>
        ) : (
          <p className="text-[13px] text-[#9b9fb3]">{t("preview.emptyInApp")}</p>
        )
      ) : channel === "push" ? (
        r.push ? (
          <div className="rounded-2xl bg-[#0b1024] p-3 text-white">
            <div className="text-[12px] text-white/60">{t("preview.pushNow")}</div>
            <div className="mt-1 text-[14px] font-semibold">{r.push.title}</div>
            <div className="mt-0.5 text-[13px] text-white/80">{r.push.body}</div>
          </div>
        ) : (
          <p className="text-[13px] text-[#9b9fb3]">{t("preview.emptyPush")}</p>
        )
      ) : r.telegram ? (
        <div className="rounded-2xl bg-[#e7ebf0] p-3">
          <div
            className="max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-tl-md bg-white px-3 py-2 text-[14px] leading-[1.5] text-[#0b1024] [overflow-wrap:anywhere] [&_a]:text-[var(--app-indigo-deep)] [&_a]:underline"
            // Текст собран сервером из экранированного ввода ROOT (<b>, <a>).
            dangerouslySetInnerHTML={{ __html: r.telegram.text }}
          />
        </div>
      ) : (
        <p className="text-[13px] text-[#9b9fb3]">{t("preview.emptyTelegram")}</p>
      )}
    </div>
  );
}
