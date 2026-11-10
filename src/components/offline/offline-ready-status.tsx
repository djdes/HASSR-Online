"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { CloudOff, RefreshCw } from "lucide-react";

import { refreshOfflineData } from "@/lib/offline/refresh";
import { getOfflineValue, listOfflineQueue, readStoredPack, subscribeOfflineStore } from "@/lib/offline/store";
import { canDeliverOfflineItem } from "@/lib/offline/sync-policy";
import { OFFLINE_APP_PATH } from "@/lib/offline/types";

import { OFFLINE_SHELL_STATE_KEY, type OfflineShellState } from "./offline-sync-agent";

type State = { reason: "reasonNoWorker" | "reasonNoPack" | "reasonNoShell" | null; savedAt: number | null; waiting: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Profile line: is this device ready to work with no network, how fresh its data is, and a button to refresh it. */
export function OfflineReadyStatus() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const t = useTranslations("offlineApp.status");
  const locale = useLocale();
  const [state, setState] = useState<State | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [stored, shell, queue] = await Promise.all([
      readStoredPack(),
      getOfflineValue<OfflineShellState>(OFFLINE_SHELL_STATE_KEY),
      listOfflineQueue(),
    ]);
    const hasPack = Boolean(stored && stored.userId === userId);
    const hasWorker = typeof navigator !== "undefined" && "serviceWorker" in navigator;
    setNow(Date.now());
    setState({
      reason: !hasWorker ? "reasonNoWorker" : !hasPack ? "reasonNoPack" : !shell?.ok ? "reasonNoShell" : null,
      savedAt: hasPack ? stored!.savedAt : null,
      waiting: queue.filter((item) => canDeliverOfflineItem(item.ownerUserId, userId)).length,
    });
  }, [userId]);

  useEffect(() => {
    // Reading the device store is asynchronous anyway — start it after the effect, not inside it.
    const first = window.setTimeout(() => void load(), 0);
    const unsubscribe = subscribeOfflineStore(() => void load());
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      window.clearTimeout(first);
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [load]);

  if (!state || !userId) return null;
  const stamp = state.savedAt
    ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(state.savedAt))
    : null;
  const stale = Boolean(state.savedAt && now && now - state.savedAt > DAY_MS);

  return (
    <div className="mini-item" data-testid="offline-ready-status">
      <CloudOff className="size-5 shrink-0" aria-hidden />
      <Link href={OFFLINE_APP_PATH} prefetch={false} className="min-w-0 flex-1" aria-label={t("openScreen")}>
        <span className="block">{state.reason ? t("notReady", { reason: t(state.reason) }) : t("ready")}</span>
        <span className="mini-item-hint block">
          {stamp ? t("dataFrom", { time: stamp }) : t("noData")}
          {stale ? ` (${t("stale")})` : ""}
          {state.waiting > 0 ? ` · ${t("waiting", { count: String(state.waiting) })}` : ""}
        </span>
      </Link>
      <button
        type="button"
        className="mini-press flex size-11 shrink-0 items-center justify-center rounded-xl"
        aria-label={refreshing ? t("refreshing") : t("refresh")}
        title={refreshing ? t("refreshing") : t("refresh")}
        disabled={refreshing}
        data-testid="offline-refresh"
        onClick={() => {
          setRefreshing(true);
          void refreshOfflineData(userId, { force: true })
            .catch(() => "failed")
            .finally(() => {
              setRefreshing(false);
              void load();
            });
        }}
      >
        <RefreshCw className={`size-5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
      </button>
    </div>
  );
}
