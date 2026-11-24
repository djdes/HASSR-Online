"use client";

import { useState } from "react";
import { Ban, Copy, Loader2, Pause, Play } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CampaignListRow } from "@/lib/mailing/campaigns.server";

import { DANGER_SM, OUTLINE_SM, api } from "./ui";

type Action = "pause" | "resume" | "duplicate" | "cancel";

/**
 * Пауза, продолжение, копия и отмена рассылки — как в YesBeat. Начатая
 * отправка может завершиться; уже отправленное остаётся у получателей.
 */
export function CampaignActions({
  campaign,
  onChanged,
  onDuplicated,
  withCancel = false,
}: {
  campaign: Pick<CampaignListRow, "id" | "title" | "status" | "counts">;
  onChanged: (row: CampaignListRow) => void;
  onDuplicated?: (row: CampaignListRow) => void;
  withCancel?: boolean;
}) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const active = campaign.status === "sending" || campaign.status === "scheduled";

  async function run(action: Action) {
    setBusy(action);
    try {
      const r = await api<{ campaign: CampaignListRow }>(`/api/root/mailing/campaigns/${campaign.id}/${action}`, {
        method: "POST",
      });
      if (action === "duplicate") {
        toast.success(`Копия «${r.campaign.title}» сохранена черновиком`);
        onDuplicated?.(r.campaign);
      } else {
        toast.success(
          action === "pause"
            ? "Рассылка на паузе — очередь её не отправляет"
            : action === "resume"
              ? r.campaign.status === "scheduled"
                ? "Рассылка снова запланирована"
                : "Отправка продолжается"
              : "Рассылка отменена — неотправленное не уйдёт"
        );
        onChanged(r.campaign);
      }
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не получилось");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const spin = (a: Action) => (busy === a ? <Loader2 className="size-4 animate-spin" /> : null);

  return (
    <>
      {active ? (
        <button type="button" className={OUTLINE_SM} disabled={busy !== null} onClick={() => void run("pause")} data-testid="campaign-pause">
          {spin("pause") ?? <Pause className="size-4 text-[#a16d32]" />} Пауза
        </button>
      ) : null}
      {campaign.status === "paused" ? (
        <button type="button" className={OUTLINE_SM} disabled={busy !== null} onClick={() => void run("resume")} data-testid="campaign-resume">
          {spin("resume") ?? <Play className="size-4 text-[#116b2a]" />} Продолжить
        </button>
      ) : null}
      {campaign.status !== "draft" && onDuplicated ? (
        <button
          type="button"
          className={OUTLINE_SM}
          disabled={busy !== null}
          onClick={() => void run("duplicate")}
          data-testid="campaign-duplicate"
          title="Новый черновик с тем же письмом, каналами, аудиторией и часами отправки"
        >
          {spin("duplicate") ?? <Copy className="size-4 text-[#5566f6]" />} Копия
        </button>
      ) : null}
      {withCancel && (active || campaign.status === "paused") ? (
        <button type="button" className={DANGER_SM} disabled={busy !== null} onClick={() => setConfirmCancel(true)} data-testid="campaign-cancel">
          <Ban className="size-4" /> Отменить
        </button>
      ) : null}
      {withCancel ? (
        <ConfirmDialog
          open={confirmCancel}
          onClose={() => setConfirmCancel(false)}
          onConfirm={async () => {
            if (await run("cancel")) setConfirmCancel(false);
          }}
          variant="danger"
          title={`Отменить «${campaign.title}»?`}
          description="Всё, что ещё в очереди, не отправится. Уже отправленное вернуть нельзя."
          bullets={[{ label: `Не отправится: ${campaign.counts.queued}` }, { label: "Отмена попадёт в аудит", tone: "info" }]}
          confirmLabel="Отменить рассылку"
        />
      ) : null}
    </>
  );
}
