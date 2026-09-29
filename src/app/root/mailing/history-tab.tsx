"use client";

import { useState } from "react";
import Link from "next/link";
import { Gauge, History, Loader2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CampaignListRow } from "@/lib/mailing/campaigns.server";
import type { MailingSettings } from "@/lib/mailing/rate-limit";
import { cn } from "@/lib/utils";

import { CARD, ChannelIcons, DANGER_SM, OUTLINE_SM, PRIMARY, SECTION_LABEL, StatusPill, api, formatDateTime } from "./ui";

export function HistoryTab({
  campaigns,
  onRefresh,
  refreshing,
  onOpenDraft,
  onDeleted,
  settings,
  sentToday,
  onSettings,
}: {
  campaigns: CampaignListRow[];
  onRefresh: () => void;
  refreshing: boolean;
  onOpenDraft: (id: string) => void;
  onDeleted: (id: string) => void;
  settings: MailingSettings;
  sentToday: number;
  onSettings: (settings: MailingSettings, sentToday: number) => void;
}) {
  const [deleting, setDeleting] = useState<CampaignListRow | null>(null);

  async function removeDraft(row: CampaignListRow) {
    try {
      await api(`/api/root/mailing/campaigns/${row.id}`, { method: "DELETE" });
      toast.success(`Черновик «${row.title}» удалён`);
      setDeleting(null);
      onDeleted(row.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить");
    }
  }

  return (
    <div className="space-y-5" data-testid="mailing-history-tab">
      <RateCard settings={settings} sentToday={sentToday} onSaved={onSettings} />

      <section className={CARD}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className={cn(SECTION_LABEL, "flex items-center gap-2")}>
            <History className="size-4 text-[#5566f6]" /> Рассылки · {campaigns.length}
          </div>
          <button type="button" className={OUTLINE_SM} onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4 text-[#5566f6]" />}
            Обновить
          </button>
        </div>
        {campaigns.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center">
            <div className="text-[15px] font-medium text-[#0b1024]">Рассылок пока не было</div>
            <p className="mx-auto mt-1.5 max-w-[380px] text-[13px] text-[#6f7282]">
              Выберите получателей и составьте сообщение — после запуска рассылка появится здесь со статусами.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {campaigns.map((c) => (
              <li
                key={c.id}
                className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4"
                data-testid="history-row"
                data-campaign-id={c.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {c.status === "draft" ? (
                        <span className="text-[16px] font-semibold text-[#0b1024] [overflow-wrap:anywhere]">{c.title}</span>
                      ) : (
                        <Link
                          href={`/root/mailing/${c.id}`}
                          className="text-[16px] font-semibold text-[#0b1024] hover:text-[#3848c7] [overflow-wrap:anywhere]"
                        >
                          {c.title}
                        </Link>
                      )}
                      <StatusPill status={c.status} label={c.statusLabel} />
                      <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[12px] text-[#6f7282]">{c.kindLabel}</span>
                    </div>
                    <div className="mt-1.5">
                      <ChannelIcons channels={c.channels} />
                    </div>
                    <div className="mt-1.5 text-[13px] text-[#6f7282]">
                      {c.status === "draft"
                        ? `Черновик от ${formatDateTime(c.createdAt)} · выбрано: пользователей ${c.selection.users}, контактов ${c.selection.contacts}`
                        : c.status === "scheduled"
                          ? `Запланирована на ${formatDateTime(c.scheduledAt)} МСК`
                          : `Запуск ${formatDateTime(c.startedAt ?? c.createdAt)}${c.finishedAt ? ` · завершена ${formatDateTime(c.finishedAt)}` : ""}${c.cancelledAt ? ` · отменена ${formatDateTime(c.cancelledAt)}` : ""}`}
                      {c.createdByName ? ` · ${c.createdByName}` : ""}
                    </div>
                    {c.lastError ? <div className="mt-1 text-[13px] text-[#a13a32]">{c.lastError}</div> : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.status === "draft" ? (
                      <>
                        <button type="button" className={OUTLINE_SM} onClick={() => onOpenDraft(c.id)}>
                          <Pencil className="size-4 text-[#5566f6]" /> Открыть
                        </button>
                        <button type="button" className={DANGER_SM} onClick={() => setDeleting(c)}>
                          <Trash2 className="size-4" /> Удалить
                        </button>
                      </>
                    ) : (
                      <Link href={`/root/mailing/${c.id}`} className={OUTLINE_SM}>
                        Получатели и статусы
                      </Link>
                    )}
                  </div>
                </div>
                {c.status !== "draft" ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="history-counters">
                    <Counter label="В очереди" value={c.counts.queued} />
                    <Counter label="Отправлено" value={c.counts.sent} tone="ok" />
                    <Counter label="Ошибка" value={c.counts.failed} tone={c.counts.failed ? "bad" : undefined} />
                    <Counter label="Пропущено" value={c.counts.skipped + c.counts.cancelled} />
                    <Counter label="Клики" value={c.counts.clicks} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => (deleting ? removeDraft(deleting) : undefined)}
        variant="danger"
        title={deleting ? `Удалить черновик «${deleting.title}»?` : "Удалить черновик?"}
        description="Черновик никуда не отправлялся — удаление ничего не отменяет у получателей."
        confirmLabel="Удалить"
      />
    </div>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone?: "ok" | "bad" }) {
  return (
    <div className="rounded-xl border border-[#ececf4] bg-white px-3 py-2">
      <div className="text-[12px] text-[#6f7282]">{label}</div>
      <div
        className={cn(
          "text-[18px] font-semibold tabular-nums",
          tone === "ok" ? "text-[#116b2a]" : tone === "bad" ? "text-[#a13a32]" : "text-[#0b1024]"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function RateCard({
  settings,
  sentToday,
  onSaved,
}: {
  settings: MailingSettings;
  sentToday: number;
  onSaved: (settings: MailingSettings, sentToday: number) => void;
}) {
  const [perMinute, setPerMinute] = useState(String(settings.perMinute));
  const [perDay, setPerDay] = useState(String(settings.perDay));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ settings: MailingSettings; sentToday: number }>("/api/root/mailing/settings", {
        method: "PUT",
        json: { perMinute: Number(perMinute), perDay: Number(perDay) },
      });
      onSaved(r.settings, r.sentToday);
      toast.success("Скорость отправки сохранена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  const left = Math.max(0, settings.perDay - sentToday);
  return (
    <section className={CARD} data-testid="mailing-rate-card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <Gauge className="size-5" />
          </span>
          <div>
            <div className="text-[16px] font-semibold text-[#0b1024]">Скорость отправки писем</div>
            <p className="mt-0.5 text-[13px] text-[#6f7282]" data-testid="sent-today">
              Сегодня отправлено <b className="tabular-nums text-[#0b1024]">{sentToday}</b> из {settings.perDay}
              {left === 0 ? " — суточный лимит исчерпан, остальные письма уйдут завтра" : ` · осталось ${left}`}.
              Колокольчик, push и Telegram лимит не считают.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-[#6f7282]">В минуту</span>
            <input
              value={perMinute}
              onChange={(e) => setPerMinute(e.target.value.replace(/\D/g, "").slice(0, 3))}
              inputMode="numeric"
              className="h-11 w-[96px] rounded-2xl border border-[#dcdfed] bg-white px-3 text-[15px] tabular-nums text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              data-testid="rate-per-minute"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-[#6f7282]">В сутки</span>
            <input
              value={perDay}
              onChange={(e) => setPerDay(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              className="h-11 w-[110px] rounded-2xl border border-[#dcdfed] bg-white px-3 text-[15px] tabular-nums text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              data-testid="rate-per-day"
            />
          </label>
          <button type="button" className={PRIMARY} disabled={busy} onClick={() => void save()} data-testid="rate-save">
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Сохранить
          </button>
        </div>
      </div>
    </section>
  );
}
