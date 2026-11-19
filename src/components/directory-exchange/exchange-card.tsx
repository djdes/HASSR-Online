"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRightLeft, Building2, Loader2, RefreshCw, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { useOrgTimeZone } from "@/components/shared/org-time-zone";
import { formatDate } from "@/i18n/locales";
import {
  exchangeError,
  exchangeParticipants,
  exchangeRequest,
  loadExchangeState,
  parseSummary,
  summaryTotals,
  type ExchangeMode,
  type ExchangeState,
} from "./exchange-api";
import { ExchangeDialog } from "./exchange-dialog";
import { ExchangeLimitNote, useResultParts } from "./exchange-result";

const CARD =
  "min-w-0 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6";
const OUTLINE =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const SOFT =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-[#eef1ff] px-4 text-[14px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#e2e7ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const NOTE =
  "mt-5 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[13px] leading-[1.5] text-[#6f7282]";

/**
 * Карточка «Обмен справочниками» в «Настройки → Мастер-кабинеты» (AC6): кто
 * из организаций аккаунта в обмене и какими списками, когда и чем закончился
 * последний обмен; настроить связь, перенести один раз, синхронизировать
 * сейчас. Только владельцу аккаунта (`canManage` считает сервер).
 */
export function ExchangeCard({
  onChanged,
}: {
  /** Связь, перенос или обмен выполнены — соседние блоки страницы стоит перечитать. */
  onChanged?: () => void;
}) {
  const t = useTranslations("dashboardUi.directoryExchange");
  const locale = useLocale();
  const timeZone = useOrgTimeZone();
  const resultParts = useResultParts();
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<ExchangeState | null>(null);
  const [dialog, setDialog] = useState<ExchangeMode | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadExchangeState().then((next) => {
      if (!alive) return;
      // Не удалось перечитать — оставляем то, что уже показано.
      if (next) setState(next);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [version]);

  async function sync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const { ok, json } = await exchangeRequest("/sync", { method: "POST" });
      if (!ok) {
        toast.error(exchangeError(json, t("card.syncFailed")));
        return;
      }
      const totals = summaryTotals(parseSummary(json?.summary));
      if (totals.created + totals.updated + totals.skippedLimit === 0) {
        toast.success(t("card.syncNoChanges"));
      } else {
        toast.success(
          t("card.syncDone", { created: String(totals.created), updated: String(totals.updated) }),
          totals.skippedLimit > 0
            ? { description: t("card.syncSkippedLimit", { count: String(totals.skippedLimit) }) }
            : undefined,
        );
      }
      setVersion((value) => value + 1);
      onChanged?.();
    } finally {
      setSyncing(false);
    }
  }

  if (loaded && (!state || !state.canManage)) return null;

  const ownId = state?.organization.id ?? "";
  const participants = state ? exchangeParticipants(state) : [];
  const lastSync = state?.lastSync ?? null;

  function lastLine(member: { organizationId: string; lastSyncedAt: string | null }): string {
    const at = member.lastSyncedAt ? new Date(member.lastSyncedAt) : null;
    if (!at || Number.isNaN(at.getTime())) return t("card.neverSynced");
    const date = formatDate(locale, at, timeZone, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    const parts = resultParts(summaryTotals(lastSync, member.organizationId));
    return [t("card.lastSync", { date }), parts.length > 0 ? parts.join(" · ") : t("card.noChanges")].join(" · ");
  }

  return (
    <section className={CARD} data-testid="exchange-card">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <ArrowRightLeft className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold leading-snug tracking-[-0.01em] text-[#0b1024]">{t("card.title")}</h2>
          <p className="mt-1 max-w-[720px] text-[13.5px] leading-[1.55] text-[#6f7282]">{t("card.description")}</p>
        </div>
      </div>

      {!state ? (
        <div className="mt-5 flex items-center gap-2 text-[13px] text-[#6f7282]">
          <Loader2 className="size-4 shrink-0 animate-spin text-[#5566f6]" aria-hidden />
          {t("card.loading")}
        </div>
      ) : state.siblings.length === 0 ? (
        <p className={NOTE} data-testid="exchange-card-empty">
          {t("card.noSiblings")}
        </p>
      ) : (
        <>
          {participants.length > 0 ? (
            <ul
              className="mt-5 divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]"
              data-testid="exchange-members"
            >
              {participants.map((member) => (
                <li key={member.organizationId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f5f6ff] text-[#5566f6]">
                    <Building2 className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 basis-[220px]">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 break-words text-[14px] font-medium text-[#0b1024]">{member.name}</span>
                      {member.organizationId === ownId ? (
                        <span className="rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[12px] font-medium text-[#3848c7]">
                          {t("card.thisOrganization")}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] leading-[1.45] text-[#6f7282]">{lastLine(member)}</span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {member.kinds.map((kind) => (
                      <span
                        key={kind}
                        className="rounded-full border border-[#dcdfed] bg-white px-2.5 py-0.5 text-[12px] font-medium text-[#3c4053]"
                      >
                        {t(`kinds.${kind}`)}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={NOTE} data-testid="exchange-card-not-configured">
              {t("card.notConfigured")}
            </p>
          )}

          {lastSync && lastSync.notes.length > 0 ? (
            <ul className="mt-3 space-y-1 text-[12.5px] leading-snug text-[#6f7282]">
              {lastSync.notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          ) : null}
          {summaryTotals(lastSync).skippedLimit > 0 ? <ExchangeLimitNote className="mt-3" /> : null}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button type="button" onClick={() => setDialog("link")} className={SOFT} data-testid="exchange-configure">
              <SlidersHorizontal className="size-4" aria-hidden />
              {t("card.configure")}
            </button>
            <button type="button" onClick={() => setDialog("transfer")} className={OUTLINE} data-testid="exchange-transfer">
              <ArrowRightLeft className="size-4 text-[#5566f6]" aria-hidden />
              {t("card.transferOnce")}
            </button>
            <button
              type="button"
              onClick={() => void sync()}
              // Обмениваться не с кем, пока в связи меньше двух организаций.
              disabled={syncing || participants.length < 2}
              title={participants.length < 2 ? t("card.notConfigured") : undefined}
              className={OUTLINE}
              data-testid="exchange-sync"
            >
              {syncing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4 text-[#5566f6]" aria-hidden />
              )}
              {t("card.syncNow")}
            </button>
          </div>
        </>
      )}

      {dialog ? (
        <ExchangeDialog
          initialMode={dialog}
          onClose={() => setDialog(null)}
          onApplied={() => {
            setVersion((value) => value + 1);
            onChanged?.();
          }}
        />
      ) : null}
    </section>
  );
}
