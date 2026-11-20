"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { Check, History, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import { useOrgTimeZone } from "@/components/shared/org-time-zone";
import { formatDate } from "@/i18n/locales";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";
import { cn } from "@/lib/utils";
import {
  exchangeError,
  loadExchangeHistory,
  parseHistoryUndo,
  parseMoment,
  undoExchangeChangeRequest,
  withChangeUndone,
  type ExchangeHistoryItem,
  type HistoryUndoOutcome,
} from "./exchange-api";
import { ConfirmStep } from "./exchange-foreign";

// Тот же вид, что у «Пропущенных записей» и «Последних переносов» (`exchange-skips.tsx`, `exchange-transfers.tsx`).
const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const ROW_BOX = "rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3";
const LIST = "divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]";
const STATUS =
  "flex items-center gap-2 rounded-2xl border border-[#ececf4] px-4 py-3 text-[13px] leading-[1.5] text-[#6f7282]";
const DANGER_TEXT_BUTTON =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#fff4f2] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d2453d]/15";
const CHIP = "rounded-full border border-[#dcdfed] bg-white px-2.5 py-0.5 text-[12px] font-medium text-[#3c4053]";
const BODY = "min-h-0 flex-1 overflow-y-auto px-5 pb-5";
const FOOTER = "shrink-0 border-t border-[#ececf4] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4";

/**
 * «История» в карточке «Обмен справочниками» (серия D, Р5): строка «История
 * обмена за 30 дней: N — Открыть» и окно со списком — что обмен создал или
 * изменил в активной организации, в каком списке, откуда (своя организация
 * — по названию; у компании другого аккаунта — только мастер-кабинет) и
 * когда. «Отменить» с подтверждением: созданное удаляется по правилам отмены
 * переноса и больше не создаётся, изменённое возвращается к прежним
 * значениям только здесь. Изменений нет — строки нет. Только владельцу
 * аккаунта: сервер отдаёт историю только ему.
 */
export function ExchangeHistory({
  refreshKey,
  className,
  onUndone,
}: {
  /** Меняется — история перечитывается (после обмена, переноса, отмены). */
  refreshKey?: number;
  className?: string;
  /** Изменение отменено — соседние блоки стоит перечитать. */
  onUndone?: () => void;
}) {
  const t = useTranslations("dashboardUi.directoryExchange.history");
  const [items, setItems] = useState<ExchangeHistoryItem[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadExchangeHistory().then((next) => {
      // Не удалось перечитать — оставляем то, что уже показано.
      if (alive && next) setItems(next);
    });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  if (items.length === 0) return null;

  return (
    <>
      <div className={cn(ROW_BOX, "flex flex-wrap items-center gap-x-2 gap-y-1", className)} data-testid="exchange-history">
        <History className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
        <span className="text-[13.5px] font-medium text-[#0b1024]">{t("count", { count: String(items.length) })}</span>
        <span className="text-[13px] text-[#9b9fb3]" aria-hidden>
          —
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[13.5px] font-medium text-[#3848c7] underline underline-offset-2"
          data-testid="exchange-history-open"
        >
          {t("open")}
        </button>
      </div>
      {open ? (
        <HistoryDialog
          items={items}
          onUndone={(id, at) => {
            setItems((current) => withChangeUndone(current, id, at));
            onUndone?.();
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function HistoryDialog({
  items,
  onUndone,
  onClose,
}: {
  items: readonly ExchangeHistoryItem[];
  onUndone: (id: string, at: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("dashboardUi.directoryExchange.history");
  const tc = useTranslations("common");
  const titleId = useId();
  // Какая строка сейчас отменяется: окно не закрывается, пока ответа нет.
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-[#0b1024]/40 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <BodyScrollLock />
      <div
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="exchange-history-dialog"
        className="flex max-h-[92dvh] w-full max-w-[600px] flex-col overflow-hidden rounded-t-3xl border border-[#ececf4] bg-white shadow-[0_30px_80px_-30px_rgba(11,16,36,0.5)] sm:rounded-3xl"
      >
        <div className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <History className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[18px] font-semibold leading-snug text-[#0b1024]">
              {t("title")}
            </h2>
            <p className="mt-1 text-[13px] leading-[1.5] text-[#6f7282]">{t("description")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            aria-label={tc("close")}
            className="-mr-1 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl text-[#6f7282] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#0b1024] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className={BODY}>
          {items.length === 0 ? (
            <div className={STATUS} data-testid="exchange-history-empty">
              <Check className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
              {t("empty")}
            </div>
          ) : (
            <ul className={LIST}>
              {items.map((item) => (
                <HistoryRow
                  key={item.id}
                  item={item}
                  locked={busy !== null && busy !== item.id}
                  onBusy={(working) => setBusy(working ? item.id : null)}
                  onUndone={(at) => onUndone(item.id, at)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className={cn(FOOTER, "flex justify-end")}>
          <button type="button" onClick={onClose} disabled={busy !== null} className={cn(PRIMARY, "w-full sm:w-auto")}>
            <Check className="size-4" aria-hidden />
            {t("done")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function HistoryRow({
  item,
  locked,
  onBusy,
  onUndone,
}: {
  item: ExchangeHistoryItem;
  /** Отменяется другая строка — эта ждёт. */
  locked: boolean;
  onBusy: (working: boolean) => void;
  onUndone: (at: string) => void;
}) {
  const t = useTranslations("dashboardUi.directoryExchange");
  const locale = useLocale();
  const timeZone = useOrgTimeZone();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<HistoryUndoOutcome | null>(null);

  const moment = (value: string | null) => {
    const at = parseMoment(value);
    return at ? formatDate(locale, at, timeZone, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : null;
  };
  const title = item.name || t(`transfers.entities.${item.entity}`);
  // Кабинета уже нет (название пустое) — «другая компания», без пустых кавычек.
  const from = item.from.cabinet
    ? item.from.name
      ? t("history.fromCabinet", { name: item.from.name })
      : t("transfers.foreignSource")
    : item.from.name;
  const undoneAt = moment(item.undoneAt);
  const meta = [t(`kinds.${item.kind}`), from, moment(item.createdAt), undoneAt ? t("history.undoneAt", { date: undoneAt }) : null]
    .filter(Boolean)
    .join(" · ");
  // Запись осталась (правили, используется) — кнопку больше не показываем.
  const canUndo = item.undoable && outcome?.kind !== "kept";

  async function undo() {
    if (working) return;
    setWorking(true);
    onBusy(true);
    try {
      const response = await undoExchangeChangeRequest(item.id);
      const parsed = parseHistoryUndo(response);
      if (!parsed) {
        toast.error(exchangeError(response.json, t("history.undoFailed")));
        return;
      }
      setConfirming(false);
      setOutcome(parsed);
      if (parsed.kind === "done") {
        toast.success(t("history.undoDone"));
        onUndone(new Date().toISOString());
      }
    } finally {
      setWorking(false);
      onBusy(false);
    }
  }

  return (
    <li className="px-4 py-3" data-testid="exchange-history-row" data-change-id={item.id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1 basis-[220px]">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 break-words text-[14px] font-medium text-[#0b1024]">{title}</span>
            <span className={CHIP}>{item.op === "create" ? t("history.created") : t("history.updated")}</span>
            {item.from.foreign && !item.from.cabinet ? (
              <span className="rounded-full border border-[#ffd9a8] bg-[#fffaf0] px-2.5 py-0.5 text-[12px] font-medium text-[#7a4a00]">
                {t("foreign.card.otherAccount")}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block break-words text-[12.5px] leading-[1.45] text-[#6f7282]">{meta}</span>
        </span>
        {canUndo && !confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={locked}
            className={DANGER_TEXT_BUTTON}
            data-testid="exchange-history-undo"
          >
            <Undo2 className="size-3.5" aria-hidden />
            {t("history.undo")}
          </button>
        ) : null}
      </div>
      {confirming ? (
        <ConfirmStep
          text={item.op === "create" ? t("history.undoCreateConfirm") : t("history.undoUpdateConfirm")}
          confirmLabel={t("history.undo")}
          busy={working}
          onConfirm={() => void undo()}
          onCancel={() => setConfirming(false)}
          testId="exchange-history-undo-confirm"
        />
      ) : null}
      {outcome ? (
        <p
          className={cn(
            "mt-2 rounded-xl border px-3 py-2 text-[12.5px] leading-[1.5]",
            outcome.kind === "done" ? "border-[#ececf4] bg-[#fafbff] text-[#3c4053]" : "border-[#ffd9a8] bg-[#fffaf0] text-[#7a4a00]",
          )}
          data-testid="exchange-history-result"
        >
          {outcome.kind === "done"
            ? t(`history.actions.${outcome.action}`)
            : t("history.kept", { reason: t(`history.reasons.${outcome.reason}`) })}
        </p>
      ) : null}
    </li>
  );
}
