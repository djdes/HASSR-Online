"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { CloudOff, ChevronRight } from "lucide-react";

import { getOfflineValue, listOfflineQueue, readStoredPack, subscribeOfflineStore } from "@/lib/offline/store";
import { canDeliverOfflineItem } from "@/lib/offline/sync-policy";
import { OFFLINE_APP_PATH } from "@/lib/offline/types";

import { OFFLINE_SHELL_STATE_KEY, type OfflineShellState } from "./offline-sync-agent";

type State = { ready: boolean; reason: string | null; savedAt: number | null; waiting: number };

function formatStamp(at: number): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(at));
}

/** Profile line: is this device ready to work with no network, and how fresh its data is. */
export function OfflineReadyStatus() {
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [stored, shell, queue] = await Promise.all([
        readStoredPack(),
        getOfflineValue<OfflineShellState>(OFFLINE_SHELL_STATE_KEY),
        listOfflineQueue(),
      ]);
      if (cancelled) return;
      const hasPack = Boolean(stored && stored.userId === userId);
      const hasWorker = typeof navigator !== "undefined" && "serviceWorker" in navigator;
      const reason = !hasWorker
        ? "браузер не умеет хранить страницы"
        : !hasPack
          ? "данные ещё скачиваются"
          : !shell?.ok
            ? "экран ещё сохраняется"
            : null;
      setState({
        ready: reason === null,
        reason,
        savedAt: hasPack ? stored!.savedAt : null,
        waiting: queue.filter((item) => canDeliverOfflineItem(item.ownerUserId, userId)).length,
      });
    }
    void load();
    const unsubscribe = subscribeOfflineStore(() => void load());
    const timer = window.setInterval(() => void load(), 15_000);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [userId]);

  if (!state) return null;
  return (
    <Link href={OFFLINE_APP_PATH} prefetch={false} className="mini-item mini-press" data-testid="offline-ready-status">
      <CloudOff className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block">{state.ready ? "Готово к работе без связи" : `Без связи пока не готово: ${state.reason}`}</span>
        <span className="mini-item-hint block">
          {state.savedAt ? `Данные от ${formatStamp(state.savedAt)}` : "Данных на устройстве нет"}
          {state.waiting > 0 ? ` · ждёт отправки: ${state.waiting}` : ""}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 opacity-60" aria-hidden />
    </Link>
  );
}
