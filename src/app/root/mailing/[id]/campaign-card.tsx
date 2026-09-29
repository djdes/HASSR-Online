"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Ban, Info, Loader2, MousePointerClick, RefreshCw, RotateCcw, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CampaignCard, RecipientFilter } from "@/lib/mailing/campaigns.server";
import {
  CHANNEL_LABELS,
  CHANNEL_STATUS_LABELS,
  MAILING_CHANNELS,
  RECIPIENT_STATUS_LABELS,
  type ChannelStatus,
} from "@/lib/mailing/labels";
import type { MailingSettings } from "@/lib/mailing/rate-limit";
import { cn } from "@/lib/utils";

import {
  CARD,
  CHANNEL_ICONS,
  ChannelIcons,
  ChannelStatusBadge,
  DANGER_SM,
  INPUT,
  Notice,
  OUTLINE_SM,
  SECTION_LABEL,
  StatusPill,
  api,
  formatDateTime,
} from "../ui";

const FILTERS: Array<{ key: RecipientFilter; label: string }> = [
  { key: "all", label: "Все" },
  { key: "queued", label: "В очереди" },
  { key: "sent", label: "Отправлено" },
  { key: "failed", label: "Ошибка" },
  { key: "skipped", label: "Пропущено" },
  { key: "cancelled", label: "Отменено" },
  { key: "clicked", label: "Кликнули" },
  { key: "test", label: "Тесты себе" },
];

const PAGE = 50;

export function CampaignCardClient({
  initial,
  settings,
  sentToday,
  dryRun,
}: {
  initial: CampaignCard;
  settings: MailingSettings;
  sentToday: number;
  dryRun: boolean;
}) {
  const [card, setCard] = useState<CampaignCard>(initial);
  const [filter, setFilter] = useState<RecipientFilter>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<"cancel" | "retry" | null>(null);
  const c = card.campaign;

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (nextOffset: number) => {
      setLoading(true);
      try {
        const q = new URLSearchParams({ filter, offset: String(nextOffset), limit: String(PAGE) });
        if (query) q.set("search", query);
        setCard(await api<CampaignCard>(`/api/root/mailing/campaigns/${initial.campaign.id}?${q}`));
        setOffset(nextOffset);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось обновить");
      } finally {
        setLoading(false);
      }
    },
    [filter, query, initial.campaign.id]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  // Пока рассылка идёт — обновляем раз в 15 секунд.
  useEffect(() => {
    if (c.status !== "sending" && c.status !== "scheduled") return;
    const t = setInterval(() => void load(offset), 15_000);
    return () => clearInterval(t);
  }, [c.status, load, offset]);

  async function cancel() {
    try {
      await api(`/api/root/mailing/campaigns/${c.id}/cancel`, { method: "POST" });
      toast.success("Рассылка отменена — неотправленное не уйдёт");
      setConfirm(null);
      void load(0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отменить");
    }
  }

  async function retry() {
    try {
      const r = await api<{ requeued: number }>(`/api/root/mailing/campaigns/${c.id}/retry`, { method: "POST" });
      toast.success(`Снова в очереди: ${r.requeued}`);
      setConfirm(null);
      void load(0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось повторить");
    }
  }

  const canCancel = c.status === "sending" || c.status === "scheduled";
  const canRetry = (c.status === "sending" || c.status === "done") && c.counts.failed > 0;
  const failedChannels = MAILING_CHANNELS.reduce((sum, ch) => sum + (card.channelBreakdown[ch].failed ?? 0), 0);

  return (
    <div className="space-y-5" data-testid="mailing-card">
      <Link href="/root/mailing?tab=history" className="inline-flex items-center gap-1.5 text-[14px] text-[#3848c7] hover:text-[#5566f6]">
        <ArrowLeft className="size-4" /> Все рассылки
      </Link>

      <section className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024] [overflow-wrap:anywhere]">
                {c.title}
              </h1>
              <StatusPill status={c.status} label={c.statusLabel} className="text-[13px]" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-[#6f7282]">
              <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[12px]">{c.kindLabel}</span>
              <ChannelIcons channels={c.channels} />
            </div>
            <div className="mt-2 text-[13px] text-[#6f7282]" data-testid="card-dates">
              {c.status === "scheduled" ? `Запланирована на ${formatDateTime(c.scheduledAt)} МСК · ` : ""}
              {c.startedAt ? `Старт ${formatDateTime(c.startedAt)} · ` : ""}
              {c.finishedAt ? `Завершена ${formatDateTime(c.finishedAt)} · ` : ""}
              {c.cancelledAt ? `Отменена ${formatDateTime(c.cancelledAt)} · ` : ""}
              Создана {formatDateTime(c.createdAt)}
              {c.createdByName ? ` · ${c.createdByName}` : ""}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={OUTLINE_SM} disabled={loading} onClick={() => void load(offset)}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4 text-[#5566f6]" />}
              Обновить
            </button>
            {canRetry ? (
              <button type="button" className={OUTLINE_SM} onClick={() => setConfirm("retry")} data-testid="card-retry">
                <RotateCcw className="size-4 text-[#5566f6]" /> Повторить неудачные
              </button>
            ) : null}
            {canCancel ? (
              <button type="button" className={DANGER_SM} onClick={() => setConfirm("cancel")} data-testid="card-cancel">
                <Ban className="size-4" /> Отменить
              </button>
            ) : null}
          </div>
        </div>

        {c.lastError ? (
          <div className="mt-4">
            <Notice tone="danger" icon={<TriangleAlert />}>
              {c.lastError}
            </Notice>
          </div>
        ) : null}
        {c.status === "sending" && c.counts.queued > 0 ? (
          <div className="mt-4">
            <Notice tone="info" icon={<Info />} testId="card-queue-note">
              В очереди {c.counts.queued}. Письма уходят по {settings.perMinute} в минуту, не больше {settings.perDay} в
              сутки (сегодня уже {sentToday}); очередь разбирается раз в минуту.
              {dryRun ? " Сейчас включена сухая отправка — наружу ничего не уходит." : ""}
            </Notice>
          </div>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="card-counters">
          <Tile label="Получателей" value={c.counts.total} />
          <Tile label="Отправлено" value={c.counts.sent} tone="ok" testId="card-sent" />
          <Tile label="В очереди" value={c.counts.queued} testId="card-queued" />
          <Tile label="Ошибка" value={c.counts.failed} tone={c.counts.failed ? "bad" : undefined} testId="card-failed" />
          <Tile label="Пропущено" value={c.counts.skipped + c.counts.cancelled} testId="card-skipped" />
        </div>
        <div className="mt-3 flex items-center gap-2 text-[14px] text-[#3c4053]" data-testid="card-clicks">
          <MousePointerClick className="size-4 text-[#5566f6]" />
          Кликнули по ссылке: <b className="tabular-nums">{c.counts.clicks}</b>
        </div>
      </section>

      <section className={CARD}>
        <div className={cn(SECTION_LABEL, "mb-3")}>По каналам</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="card-channels">
          {MAILING_CHANNELS.filter((ch) => c.channels[ch]).map((ch) => {
            const Icon = CHANNEL_ICONS[ch];
            const counts = card.channelBreakdown[ch];
            return (
              <div key={ch} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4" data-testid={`card-channel-${ch}`}>
                <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
                  <Icon className="size-4 text-[#5566f6]" /> {CHANNEL_LABELS[ch]}
                </div>
                <ul className="mt-2 space-y-1 text-[13px] text-[#3c4053]">
                  {(["sent", "queued", "sending", "failed", "skipped"] as ChannelStatus[])
                    .filter((s) => counts[s])
                    .map((s) => (
                      <li key={s} className="flex justify-between gap-2">
                        <span>{CHANNEL_STATUS_LABELS[s]}</span>
                        <b className="tabular-nums">{counts[s]}</b>
                      </li>
                    ))}
                  {Object.keys(counts).length === 0 ? <li className="text-[#9b9fb3]">нет получателей</li> : null}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <section className={CARD}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className={SECTION_LABEL}>Получатели · {card.total}</div>
          <label className="relative block w-full sm:w-[300px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Имя, почта, компания"
              className={cn(INPUT, "pl-10")}
            />
          </label>
        </div>
        <div className="mb-4 flex flex-wrap gap-1.5" data-testid="card-filters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                "inline-flex h-8 items-center rounded-xl px-3 text-[13px] font-medium transition-colors",
                filter === f.key ? "bg-[#eef1ff] text-[#3848c7]" : "text-[#6f7282] hover:bg-[#f5f6ff]"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {card.recipients.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center text-[13px] text-[#6f7282]">
            Под этот фильтр никто не попал.
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1040px] text-[14px]" data-testid="card-recipients">
                <thead className="text-left text-[12px] text-[#6f7282]">
                  <tr className="border-b border-[#ececf4]">
                    <th className="py-2.5 pr-3 font-medium">Получатель</th>
                    {MAILING_CHANNELS.filter((ch) => c.channels[ch]).map((ch) => (
                      <th key={ch} className="py-2.5 pr-3 font-medium">
                        {CHANNEL_LABELS[ch]}
                      </th>
                    ))}
                    <th className="py-2.5 pr-3 font-medium">Итог</th>
                    <th className="py-2.5 font-medium">Клик</th>
                  </tr>
                </thead>
                <tbody>
                  {card.recipients.map((r) => (
                    <tr key={r.id} className="border-b border-[#f2f3f8] align-top" data-testid="card-recipient-row" data-email={r.email ?? ""}>
                      <td className="max-w-[260px] py-3 pr-3">
                        <div className="font-medium text-[#0b1024]">{r.name || r.email || "—"}</div>
                        <div className="text-[13px] text-[#6f7282] [overflow-wrap:anywhere]">
                          {r.email ?? "нет почты"}
                          {r.companyName ? ` · ${r.companyName}` : ""}
                        </div>
                        <div className="mt-0.5 text-[12px] text-[#9b9fb3]">
                          {r.isTest ? "тест себе" : r.kind === "contact" ? "контакт" : "пользователь"}
                          {r.unsubscribedAt ? " · отписался" : ""}
                        </div>
                      </td>
                      {MAILING_CHANNELS.filter((ch) => c.channels[ch]).map((ch) => (
                        <td key={ch} className="max-w-[220px] py-3 pr-3">
                          {r.channels[ch] ? (
                            <ChannelStatusBadge status={r.channels[ch]!.status} error={r.channels[ch]!.error} dryRun={r.dryRun} />
                          ) : (
                            <span className="text-[12px] text-[#9b9fb3]">—</span>
                          )}
                        </td>
                      ))}
                      <td className="py-3 pr-3">
                        <StatusPill status={r.status} label={RECIPIENT_STATUS_LABELS[r.status as keyof typeof RECIPIENT_STATUS_LABELS] ?? r.status} />
                        {r.attempts > 0 ? <div className="mt-1 text-[12px] text-[#9b9fb3]">попыток: {r.attempts}</div> : null}
                        {r.sentAt ? <div className="mt-1 text-[12px] text-[#9b9fb3]">{formatDateTime(r.sentAt)}</div> : null}
                      </td>
                      <td className="py-3 text-[13px] text-[#3c4053]" data-testid="card-recipient-click">
                        {r.clickedAt ? `${formatDateTime(r.clickedAt)} (${r.clickCount})` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="space-y-2 lg:hidden">
              {card.recipients.map((r) => (
                <li key={r.id} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3" data-testid="card-recipient-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-[#0b1024]">{r.name || r.email || "—"}</div>
                      <div className="text-[13px] text-[#6f7282] [overflow-wrap:anywhere]">{r.email ?? "нет почты"}</div>
                    </div>
                    <StatusPill status={r.status} label={RECIPIENT_STATUS_LABELS[r.status as keyof typeof RECIPIENT_STATUS_LABELS] ?? r.status} />
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {MAILING_CHANNELS.filter((ch) => r.channels[ch]).map((ch) => (
                      <div key={ch} className="rounded-xl border border-[#ececf4] bg-white p-2">
                        <div className="mb-1 text-[12px] font-medium text-[#6f7282]">{CHANNEL_LABELS[ch]}</div>
                        <ChannelStatusBadge status={r.channels[ch]!.status} error={r.channels[ch]!.error} dryRun={r.dryRun} />
                      </div>
                    ))}
                  </div>
                  {r.clickedAt ? (
                    <div className="mt-2 text-[12px] text-[#3848c7]">Клик: {formatDateTime(r.clickedAt)}</div>
                  ) : null}
                </li>
              ))}
            </ul>

            {card.total > PAGE ? (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[13px] text-[#6f7282]">
                <button type="button" className={OUTLINE_SM} disabled={offset === 0 || loading} onClick={() => void load(Math.max(0, offset - PAGE))}>
                  Назад
                </button>
                <span className="tabular-nums">
                  {offset + 1}–{Math.min(offset + PAGE, card.total)} из {card.total}
                </span>
                <button
                  type="button"
                  className={OUTLINE_SM}
                  disabled={offset + PAGE >= card.total || loading}
                  onClick={() => void load(offset + PAGE)}
                >
                  Дальше
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      <ConfirmDialog
        open={confirm === "cancel"}
        onClose={() => setConfirm(null)}
        onConfirm={cancel}
        variant="danger"
        title={`Отменить «${c.title}»?`}
        description="Всё, что ещё в очереди, не отправится. Уже отправленное вернуть нельзя."
        bullets={[
          { label: `Не отправится: ${c.counts.queued}` },
          { label: "Отмена попадёт в аудит", tone: "info" },
        ]}
        confirmLabel="Отменить рассылку"
      />
      <ConfirmDialog
        open={confirm === "retry"}
        onClose={() => setConfirm(null)}
        onConfirm={retry}
        variant="info"
        title="Повторить неудачные?"
        description="Каналы с ошибкой вернутся в очередь, счётчик попыток обнулится."
        bullets={[
          { label: `Каналов с ошибкой: ${failedChannels}` },
          { label: "Адреса, попавшие в стоп-лист, всё равно пропустятся", tone: "info" },
          { label: "Ограничение скорости писем действует и на повтор", tone: "info" },
        ]}
        confirmLabel="Повторить"
      />
    </div>
  );
}

function Tile({ label, value, tone, testId }: { label: string; value: number; tone?: "ok" | "bad"; testId?: string }) {
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
      <div className="text-[12px] font-medium text-[#6f7282]">{label}</div>
      <div
        className={cn(
          "mt-1 text-[22px] font-semibold leading-none tabular-nums",
          tone === "ok" ? "text-[#116b2a]" : tone === "bad" ? "text-[#a13a32]" : "text-[#0b1024]"
        )}
        data-testid={testId}
      >
        {value}
      </div>
    </div>
  );
}
