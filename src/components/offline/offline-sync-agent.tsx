"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import { useTranslations } from "next-intl";

import { noteDeliveredRecords, refreshOfflineData, sendOfflineHeartbeat } from "@/lib/offline/refresh";
import { setOfflineValue, isOfflineStoreAvailable } from "@/lib/offline/store";
import { flushOfflineQueue } from "@/lib/offline/sync";
import { OFFLINE_APP_PATH } from "@/lib/offline/types";

/** Device-side state of the cached offline screen, read by the status line in the profile. */
export const OFFLINE_SHELL_STATE_KEY = "shell";
export type OfflineShellState = { ok: boolean; at: number; error?: string };

/**
 * Keeps the device ready to work with no network while the cabinet is open
 * online: downloads the offline pack, asks the service worker to store the
 * offline screen and delivers records made without network. Renders nothing.
 */
export function OfflineSyncAgent() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const shellAsked = useRef(false);
  const t = useTranslations("offlineApp.toast");
  // The tick lives in an effect keyed by the account only — texts are read through a ref.
  const copyRef = useRef(t);
  useEffect(() => {
    copyRef.current = t;
  }, [t]);

  useEffect(() => {
    if (!userId || !isOfflineStoreAvailable()) return;
    let cancelled = false;
    let running = false;

    async function askShell() {
      if (shellAsked.current || !("serviceWorker" in navigator)) return;
      const registration = await navigator.serviceWorker.ready;
      if (!registration.active) return;
      shellAsked.current = true;
      registration.active.postMessage({ type: "PRECACHE_OFFLINE" });
    }

    async function tick() {
      if (running || cancelled || navigator.onLine === false) return;
      running = true;
      try {
        await refreshOfflineData(userId!).catch(() => undefined);
        await askShell().catch(() => undefined);
        const summary = await flushOfflineQueue(userId);
        await noteDeliveredRecords(summary.sent).catch(() => undefined);
        // The device reports itself: the manager's list and "device is silent" notices are built from it.
        await sendOfflineHeartbeat(userId!).catch(() => undefined);
        if (cancelled) return;
        const copy = copyRef.current;
        if (summary.sent > 0) toast.success(copy("sent", { count: String(summary.sent) }));
        const stuck = summary.rejected + summary.conflicts;
        if (stuck > 0) {
          toast.warning(copy("stuck", { count: String(stuck) }), {
            id: "offline-stuck",
            description: copy("stuckHint"),
            action: { label: copy("open"), onClick: () => window.location.assign(`${OFFLINE_APP_PATH}#queue`) },
          });
        }
      } finally {
        running = false;
      }
    }

    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: string; ok?: boolean; error?: string } | null;
      if (data?.type !== "OFFLINE_APP_READY") return;
      void setOfflineValue(OFFLINE_SHELL_STATE_KEY, { ok: data.ok === true, at: Date.now(), error: data.error } satisfies OfflineShellState).catch(() => undefined);
      // A failed download is retried on the next tick (new deploy mid-download, flaky network).
      if (data.ok !== true) shellAsked.current = false;
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    const onOnline = () => void tick();
    navigator.serviceWorker?.addEventListener("message", onMessage);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    const timer = window.setInterval(() => void tick(), 60_000);

    return () => {
      cancelled = true;
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [userId]);

  return null;
}
