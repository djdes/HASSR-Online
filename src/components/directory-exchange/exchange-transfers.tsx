"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, History, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { useOrgTimeZone } from "@/components/shared/org-time-zone";
import { formatDate } from "@/i18n/locales";
import {
  EXCHANGE_KINDS,
  exchangeError,
  loadRecentTransfers,
  parseMoment,
  parseTransferUndo,
  undoTransferRequest,
  withTransferUndone,
  type RecentTransfer,
  type TransferUndoResult,
} from "./exchange-api";
import { ConfirmStep } from "./exchange-foreign";

const SECTION_TITLE = "text-[13px] font-medium text-[#3c4053]";
const DANGER_TEXT_BUTTON =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#fff4f2] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d2453d]/15";
const CHIP = "rounded-full border border-[#dcdfed] bg-white px-2.5 py-0.5 text-[12px] font-medium text-[#3c4053]";
/** Сколько названий показать в итоге, прежде чем свернуть остальные в «и ещё N». */
const PREVIEW = 8;

/**
 * «Последние переносы» в карточке «Обмен справочниками» (серия B, пункт 12):
 * разовые переносы последних 7 дней в организации аккаунта — откуда и куда,
 * когда, сколько создано, — и «Отменить» с подтверждением. После отмены —
 * итог: что отменено и что осталось и почему. Переносов нет — блока нет.
 * Только владельцу аккаунта: сервер отдаёт список только ему.
 */
export function ExchangeTransfers({
  refreshKey,
  className,
  onUndone,
}: {
  /** Меняется — список перечитывается (после переноса, обмена, отмены). */
  refreshKey?: number;
  className?: string;
  /** Перенос отменён — соседние блоки стоит перечитать. */
  onUndone?: () => void;
}) {
  const t = useTranslations("dashboardUi.directoryExchange.transfers");
  const [transfers, setTransfers] = useState<RecentTransfer[]>([]);

  useEffect(() => {
    let alive = true;
    void loadRecentTransfers().then((next) => {
      // Не удалось перечитать — оставляем то, что уже показано.
      if (alive && next) setTransfers(next);
    });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (transfers.length === 0) return null;

  return (
    <div className={className} data-testid="exchange-transfers">
      <div className={SECTION_TITLE}>{t("title")}</div>
      <p className="mt-1 max-w-[720px] text-[12.5px] leading-[1.5] text-[#6f7282]">{t("hint")}</p>
      <ul className="mt-2 divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]">
        {transfers.map((transfer) => (
          <TransferRow
            key={transfer.id}
            transfer={transfer}
            onUndone={(result, at) => {
              setTransfers((current) => withTransferUndone(current, transfer.id, result, at));
              onUndone?.();
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function TransferRow({
  transfer,
  onUndone,
}: {
  transfer: RecentTransfer;
  onUndone: (result: TransferUndoResult, at: string) => void;
}) {
  const t = useTranslations("dashboardUi.directoryExchange");
  const locale = useLocale();
  const timeZone = useOrgTimeZone();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const moment = (value: string | null) => {
    const at = parseMoment(value);
    return at ? formatDate(locale, at, timeZone, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : null;
  };
  const created = moment(transfer.createdAt);
  const undoneAt = moment(transfer.undoneAt);
  const undoUntil = moment(transfer.undoUntil);
  const fromName = transfer.from.name || (transfer.from.foreign ? t("transfers.foreignSource") : "—");
  const counts = EXCHANGE_KINDS.filter((kind) => transfer.counts[kind] > 0).map((kind) =>
    t("transfers.count", { kind: t(`kinds.${kind}`), count: String(transfer.counts[kind]) }),
  );
  let status: string | null = null;
  if (undoneAt) status = t("transfers.undoneAt", { date: undoneAt });
  else if (transfer.undoable && undoUntil) status = t("transfers.undoUntil", { date: undoUntil });
  else if (!transfer.undoable) status = t("transfers.expired");

  async function undo() {
    if (busy) return;
    setBusy(true);
    try {
      const { ok, json } = await undoTransferRequest(transfer.id);
      const result = ok ? parseTransferUndo(json?.result) : null;
      if (!result) {
        toast.error(exchangeError(json, t("transfers.undoFailed")));
        return;
      }
      setConfirming(false);
      toast.success(t("transfers.undoDone"));
      onUndone(result, new Date().toISOString());
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-4 py-3" data-testid="exchange-transfer-row" data-transfer-id={transfer.id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f5f6ff] text-[#5566f6]">
          <History className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 basis-[220px]">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] font-medium text-[#0b1024]">
            <span className="min-w-0 break-words">{fromName}</span>
            {transfer.from.foreign ? (
              <span className="rounded-full border border-[#ffd9a8] bg-[#fffaf0] px-2.5 py-0.5 text-[12px] font-medium text-[#7a4a00]">
                {t("foreign.card.otherAccount")}
              </span>
            ) : null}
            <ArrowRight className="size-3.5 shrink-0 text-[#9b9fb3]" aria-hidden />
            <span className="min-w-0 break-words">{transfer.to.name}</span>
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-[1.45] text-[#6f7282]">
            {[created, status].filter(Boolean).join(" · ")}
          </span>
        </span>
        {counts.length > 0 ? (
          <span className="flex flex-wrap gap-1.5">
            {counts.map((label) => (
              <span key={label} className={CHIP}>
                {label}
              </span>
            ))}
          </span>
        ) : null}
        {transfer.undoable && !confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={DANGER_TEXT_BUTTON}
            data-testid="exchange-transfer-undo"
          >
            <Undo2 className="size-3.5" aria-hidden />
            {t("transfers.undo")}
          </button>
        ) : null}
      </div>
      {confirming ? (
        <ConfirmStep
          text={t("transfers.undoConfirm")}
          confirmLabel={t("transfers.undo")}
          busy={busy}
          onConfirm={() => void undo()}
          onCancel={() => setConfirming(false)}
          testId="exchange-transfer-undo-confirm"
        />
      ) : null}
      {transfer.undo ? <UndoResult result={transfer.undo} /> : null}
    </li>
  );
}

/** Итог отмены: что отменено (названия) и что осталось — с причиной у каждой записи. */
function UndoResult({ result }: { result: TransferUndoResult }) {
  const t = useTranslations("dashboardUi.directoryExchange.transfers");
  if (result.undone.length + result.kept.length === 0) {
    return <p className="mt-2 text-[12.5px] leading-[1.5] text-[#6f7282]">{t("resultNothing")}</p>;
  }
  const names = result.undone.slice(0, PREVIEW).map((item) => item.name).filter(Boolean);
  const moreUndone = result.undone.length - Math.min(result.undone.length, PREVIEW);
  const kept = result.kept.slice(0, PREVIEW);
  const moreKept = result.kept.length - kept.length;
  return (
    <div
      className="mt-2 space-y-1.5 rounded-xl border border-[#ececf4] bg-[#fafbff] px-3 py-2 text-[12.5px] leading-[1.5] text-[#3c4053]"
      data-testid="exchange-transfer-result"
    >
      {result.undone.length > 0 ? (
        <p>
          <span className="font-medium">{t("resultUndone", { count: String(result.undone.length) })}</span>
          {names.length > 0 ? ` — ${names.join(", ")}` : null}
          {moreUndone > 0 ? ` ${t("more", { count: String(moreUndone) })}` : null}
        </p>
      ) : null}
      {result.kept.length > 0 ? (
        <div>
          <p className="font-medium">{t("resultKept", { count: String(result.kept.length) })}</p>
          <ul className="mt-0.5 space-y-0.5 text-[#6f7282]">
            {kept.map((item) => {
              const entity = t(`entities.${item.entity}`);
              const reason = t(`reasons.${item.reason}`);
              return (
                <li key={`${item.entity}:${item.id}`} data-testid="exchange-transfer-kept">
                  {item.name ? t("keptItem", { entity, name: item.name, reason }) : t("keptItemNoName", { entity, reason })}
                </li>
              );
            })}
            {moreKept > 0 ? <li>{t("more", { count: String(moreKept) })}</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
