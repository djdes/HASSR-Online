"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { CallbackListener, PlayerRef } from "@remotion/player";

/** Текущий кадр Плеера — подписка на frameupdate/seeked (паттерн из
    доков Remotion, useSyncExternalStore). До маунта Плеера — кадр 0. */
export function usePlayerFrame(player: PlayerRef | null): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!player) return () => undefined;
      const onFrame: CallbackListener<"frameupdate"> = () => onChange();
      const onSeek: CallbackListener<"seeked"> = () => onChange();
      player.addEventListener("frameupdate", onFrame);
      player.addEventListener("seeked", onSeek);
      return () => {
        player.removeEventListener("frameupdate", onFrame);
        player.removeEventListener("seeked", onSeek);
      };
    },
    [player]
  );
  return useSyncExternalStore(
    subscribe,
    () => player?.getCurrentFrame() ?? 0,
    () => 0
  );
}

/** Идёт ли ролик: события play/pause Плеера. */
export function usePlayerPlaying(player: PlayerRef | null): boolean {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!player) return;
    setPlaying(player.isPlaying());
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    return () => {
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
    };
  }, [player]);
  return playing;
}

/* Размер композиции — по тому же брейкпоинту, что аспект сцены (md):
   телефон 4:5, десктоп 16:9. Внутрисценовые md:-классы остаются
   согласованы с формой кадра. */
export const MOBILE_COMPOSITION = { width: 480, height: 600 } as const;
export const DESKTOP_COMPOSITION = { width: 1120, height: 630 } as const;
export const DESKTOP_QUERY = "(min-width: 768px)";
