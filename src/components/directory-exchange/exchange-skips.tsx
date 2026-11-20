"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, Info, Link2, ListChecks, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { BILLING_PAY_HREF } from "@/lib/billing-period";
import { parseExchangeSkips, withoutSkip, type ExchangeSkipItem, type ExchangeSkipsView } from "@/lib/directory-exchange/skips";
import { isInsideMobileApp } from "@/lib/mobile-app";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";
import { cn } from "@/lib/utils";
import { exchangeError, requestExchangeSkips, resolveExchangeSkip, type ExchangeSkipAction } from "./exchange-api";

// Тот же вид, что у окна и карточки обмена (`exchange-dialog.tsx`, `exchange-foreign.tsx`).
const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const SECTION_TITLE = "text-[13px] font-medium text-[#3c4053]";
const LIST = "mt-2 divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]";
const STATUS =
  "flex items-center gap-2 rounded-2xl border border-[#ececf4] px-4 py-3 text-[13px] leading-[1.5] text-[#6f7282]";
const ROW_BOX = "rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3";
const TEXT_BUTTON =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_OUTLINE =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const SELECT =
  "h-9 min-w-0 max-w-full flex-1 basis-[180px] rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] text-[#0b1024] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-50";
const BODY = "min-h-0 flex-1 overflow-y-auto px-5 pb-5";
const FOOTER = "shrink-0 border-t border-[#ececf4] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4";

/**
 * Пропущенные записи обмена (серия B, пункт 9, Р9.2–Р9.3): строка
 * «Пропущено: N — Разобрать» в карточке «Обмен справочниками» и окно со
 * списком по организациям — название, список, причина простыми словами.
 * «Не переносить» — обмен больше не пробует; «Связать с …» — с записью того
 * же названия, которая у организации уже есть; нет мест в тарифе — ссылка на
 * тариф, запись добавится при следующем обмене. Сервер отдаёт только свои
 * организации аккаунта; пропусков нет — строки нет.
 */
export function ExchangeSkips({ refreshKey, className }: { refreshKey?: number; className?: string }) {
  const t = useTranslations("dashboardUi.directoryExchange.skips");
  const [view, setView] = useState<ExchangeSkipsView | null>(null);
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    void requestExchangeSkips().then(({ ok, json }) => {
      // Не удалось перечитать — оставляем то, что уже показано.
      if (alive && ok) setView(parseExchangeSkips(json));
    });
    return () => {
      alive = false;
    };
  }, [refreshKey, reload]);

  const total = view?.total ?? 0;
  return (
    <>
      {total > 0 ? (
        <div className={cn(ROW_BOX, "flex flex-wrap items-center gap-x-2 gap-y-1", className)} data-testid="exchange-skips">
          <ListChecks className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
          <span className="text-[13.5px] font-medium text-[#0b1024]">{t("count", { count: String(total) })}</span>
          <span className="text-[13px] text-[#9b9fb3]" aria-hidden>
            —
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[13.5px] font-medium text-[#3848c7] underline underline-offset-2"
            data-testid="exchange-skips-open"
          >
            {t("review")}
          </button>
        </div>
      ) : null}
      {open && view ? (
        <SkipsDialog
          view={view}
          onHandled={(id) => setView((current) => (current ? withoutSkip(current, id) : current))}
          onStale={() => setReload((value) => value + 1)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function SkipsDialog({
  view,
  onHandled,
  onStale,
  onClose,
}: {
  view: ExchangeSkipsView;
  onHandled: (id: string) => void;
  /** Строку уже разобрали в другом окне или обмен её убрал — перечитать список. */
  onStale: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("dashboardUi.directoryExchange.skips");
  const tc = useTranslations("common");
  const titleId = useId();
  // Какое действие идёт: «id|action».
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function act(body: ExchangeSkipAction) {
    if (busy) return;
    setBusy(`${body.id}|${body.action}`);
    try {
      const { ok, status, json } = await resolveExchangeSkip(body);
      if (!ok) {
        toast.error(exchangeError(json, t("failed")));
        if (status === 404 || status === 409) onStale();
        return;
      }
      toast.success(body.action === "ignore" ? t("ignored") : t("linked"));
      onHandled(body.id);
    } finally {
      setBusy(null);
    }
  }

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
        data-testid="exchange-skips-dialog"
        className="flex max-h-[92dvh] w-full max-w-[560px] flex-col overflow-hidden rounded-t-3xl border border-[#ececf4] bg-white shadow-[0_30px_80px_-30px_rgba(11,16,36,0.5)] sm:rounded-3xl"
      >
        <div className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <ListChecks className="size-5" aria-hidden />
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
          {view.total === 0 ? (
            <div className={STATUS} data-testid="exchange-skips-empty">
              <Check className="size-4 shrink-0 text-[#5566f6]" aria-hidden />
              {t("empty")}
            </div>
          ) : (
            <div className="space-y-4">
              {view.organizations.map((organization) => (
                <section key={organization.organizationId}>
                  <div className={cn(SECTION_TITLE, "break-words")}>{organization.name}</div>
                  <ul className={LIST}>
                    {organization.items.map((item) => (
                      <SkipRow key={item.id} item={item} busy={busy} onAct={(body) => void act(body)} onNavigate={onClose} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
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

function SkipRow({
  item,
  busy,
  onAct,
  onNavigate,
}: {
  item: ExchangeSkipItem;
  busy: string | null;
  onAct: (body: ExchangeSkipAction) => void;
  onNavigate: () => void;
}) {
  const t = useTranslations("dashboardUi.directoryExchange");
  const [choice, setChoice] = useState(item.candidates[0]?.id ?? "");
  const working = (action: ExchangeSkipAction["action"]) => busy === `${item.id}|${action}`;
  const locked = busy !== null;
  const single = item.candidates.length === 1 ? item.candidates[0] : null;
  const label = (candidate: { name: string; detail: string | null }) =>
    candidate.detail ? `${candidate.name} — ${candidate.detail}` : candidate.name;

  return (
    <li className="px-4 py-3" data-testid="exchange-skip" data-skip-id={item.id}>
      <div className="break-words text-[14px] font-medium leading-snug text-[#0b1024]">{item.name}</div>
      <div className="mt-0.5 text-[12.5px] leading-[1.45] text-[#6f7282]">
        {t(`kinds.${item.kind}`)} · {item.reason === "limit" ? t("skips.reasonLimit") : t("skips.reasonConflict")}
      </div>

      {item.reason === "limit" ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-[1.45] text-[#6f7282]">
          <Info className="mt-0.5 size-3.5 shrink-0 text-[#5566f6]" aria-hidden />
          <span className="min-w-0 flex-1">
            {t("skips.limitRetry")}
            {/* В приложении WeSetup к оплате не зовём (правила сторов) — там только текст. */}
            {isInsideMobileApp() ? null : (
              <>
                {" "}
                <Link
                  href={BILLING_PAY_HREF}
                  onClick={onNavigate}
                  className="font-medium text-[#3848c7] underline underline-offset-2"
                  data-testid="exchange-skip-plan"
                >
                  {t("skips.openPlan")}
                </Link>
              </>
            )}
          </span>
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {item.reason === "conflict" && item.candidates.length > 1 ? (
          <select
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            disabled={locked}
            aria-label={t("skips.chooseLabel")}
            className={SELECT}
            data-testid="exchange-skip-choice"
          >
            {item.candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {label(candidate)}
              </option>
            ))}
          </select>
        ) : null}
        {item.reason === "conflict" && item.candidates.length > 0 ? (
          <button
            type="button"
            onClick={() => onAct({ id: item.id, action: "link", entityId: single?.id ?? choice })}
            disabled={locked || !(single?.id ?? choice)}
            className={cn(SMALL_OUTLINE, "max-w-full")}
            data-testid="exchange-skip-link"
          >
            {working("link") ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Link2 className="size-3.5 text-[#5566f6]" aria-hidden />
            )}
            <span className="min-w-0 truncate">
              {single ? t("skips.link", { name: single.name }) : t("skips.linkChosen")}
            </span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onAct({ id: item.id, action: "ignore" })}
          disabled={locked}
          className={TEXT_BUTTON}
          data-testid="exchange-skip-ignore"
        >
          {working("ignore") ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          {t("skips.ignore")}
        </button>
      </div>
    </li>
  );
}
