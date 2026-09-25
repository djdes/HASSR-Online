"use client";

import { Cloud, CloudOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOfflineQueue } from "@/lib/use-offline-submit";

/**
 * Индикатор сети + очереди. Рендерится в шапке dashboard. Если
 * online + очередь пуста — компактная зелёная точка (почти не видна).
 * Если очередь не пуста или offline — контрастная плашка с кнопкой
 * «Отправить сейчас».
 */
export function OfflineIndicator() {
  const { online, pending, flushNow, busy } = useOfflineQueue();

  // Всё в порядке — молчим. Зелёная плашка «В сети» висела в шапке
  // постоянно и не несла информации: связь есть у всех и почти всегда.
  // Показываем индикатор только когда есть о чём сказать — офлайн или
  // неотправленная очередь.
  if (online && pending === 0) return null;

  const label = online
    ? `В сети · ждёт отправки ${pending}`
    : pending > 0
      ? `Офлайн · ${pending} в очереди`
      : "Офлайн";

  return (
    <button
      type="button"
      onClick={() => void flushNow()}
      disabled={busy || pending === 0}
      title={
        online
          ? "Есть записи, которые не успели уйти. Нажмите, чтобы отправить сейчас."
          : "Нет интернета. Записи сохраняются локально и отправятся, когда сеть вернётся."
      }
      className={cn(
        // На телефоне 44px — как остальные кнопки шапки.
        "inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition-colors duration-200 sm:h-10",
        online
          ? "bg-[#fff8eb] text-[#b25f00] hover:bg-[#fff4d9]"
          : "bg-[#fff4f2] text-[#a13a32] hover:bg-[#ffe9e4]"
      )}
    >
      {busy ? (
        <RefreshCw className="size-4 animate-spin" />
      ) : online ? (
        <Cloud className="size-4" />
      ) : (
        <CloudOff className="size-4" />
      )}
      {label}
    </button>
  );
}
