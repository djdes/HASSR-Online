"use client";

import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Player, type PlayerRef } from "@remotion/player";
import { Pause, Play, Smartphone, X } from "lucide-react";

import { useMediaQuery } from "@/lib/use-media-query";

import { formatClock } from "./clock";
import { CHAPTERS, DURATION_IN_FRAMES, FPS, chapterAt, type ChapterId } from "./chapters";
import { QrComposition } from "./composition";
import { DESKTOP_COMPOSITION, DESKTOP_QUERY, MOBILE_COMPOSITION, usePlayerFrame, usePlayerPlaying } from "./player-state";
import { STAGE_BACKGROUND, type SceneDay } from "./scene";
import type { QrMatrix } from "./qr-sticker";

/**
 * Ролик на весь экран — «как плеер YouTube». Тёмный слой `fixed inset-0`
 * на 100dvh поверх страницы (портал в body, фон страницы `inert`). Где
 * есть Fullscreen API (компьютер, Android) — ещё и системный полный
 * экран; на iPhone API для обычных элементов нет, там остаётся слой.
 *
 * Внутри — свой `<Player>` той же композиции: 16:9 от md, на телефоне в
 * портрете 4:5 по ширине и подсказка «Поверните телефон». Управление:
 * пауза, перемотка по главам (сегменты — как главы у YouTube), закрыть.
 * Esc, крестик и выход из системного полного экрана закрывают слой;
 * родитель получает кадр и состояние, чтобы ролик на странице
 * продолжил с того же места.
 */

const SEEK_STEP_SECONDS = 5;
/** Через сколько покоя прячется управление, пока ролик идёт. */
const IDLE_MS = 2600;

export type FullscreenResult = { frame: number; playing: boolean };

/** Эти дети body не рисуются — `inert` им не нужен. */
const NON_VISUAL = new Set(["SCRIPT", "STYLE", "LINK", "NOSCRIPT", "TEMPLATE"]);

export function FullscreenPlayer({
  qr,
  today,
  fridgeTemp,
  bodyTemp,
  startFrame,
  autoPlay,
  chapterLabels,
  onClose,
  extraAction,
}: {
  qr: QrMatrix;
  today: SceneDay;
  fridgeTemp: number;
  bodyTemp: number;
  startFrame: number;
  autoPlay: boolean;
  chapterLabels: Record<ChapterId, string>;
  onClose: (result: FullscreenResult) => void;
  /** Дополнительная кнопка в шапке (видео со звуком, этап 2). */
  extraAction?: ReactNode;
}) {
  const t = useTranslations("qrPlayer");
  const overlayRef = useRef<HTMLDivElement>(null);
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const playerRef = useCallback((instance: PlayerRef | null) => setPlayer(instance), []);
  const frame = usePlayerFrame(player);
  const playing = usePlayerPlaying(player);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const portraitPhone = useMediaQuery("(max-width: 767px) and (orientation: portrait)");
  const composition = desktop ? DESKTOP_COMPOSITION : MOBILE_COMPOSITION;
  const ratio = composition.width / composition.height;

  // Старт с того кадра, где зритель был на странице.
  const started = useRef(false);
  useEffect(() => {
    if (!player || started.current) return;
    started.current = true;
    player.seekTo(startFrame);
    if (autoPlay) player.play();
  }, [player, startFrame, autoPlay]);

  const closing = useRef(false);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const result = { frame: player?.getCurrentFrame() ?? startFrame, playing: player?.isPlaying() ?? false };
    player?.pause();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    onClose(result);
  }, [player, startFrame, onClose]);
  const closeLatest = useRef(close);
  useEffect(() => {
    closeLatest.current = close;
  }, [close]);

  // Системный полный экран, где он есть. Esc в нём перехватывает браузер:
  // выход из полного экрана закрывает и слой — одно нажатие, как у видео.
  useEffect(() => {
    const node = overlayRef.current;
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement === node) {
        entered = true;
        return;
      }
      if (entered && !document.fullscreenElement) closeLatest.current();
    };
    document.addEventListener("fullscreenchange", onChange);
    if (node && document.fullscreenEnabled && typeof node.requestFullscreen === "function") {
      node.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
    }
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Страница под слоем не прокручивается и не ловит фокус; фокус — на слое.
  useEffect(() => {
    const root = document.documentElement;
    const host = overlayRef.current;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    const siblings = Array.from(document.body.children).filter(
      (element) => element !== host && !element.hasAttribute("inert") && !NON_VISUAL.has(element.tagName),
    );
    for (const element of siblings) element.setAttribute("inert", "");
    host?.focus({ preventScroll: true });
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeLatest.current();
    };
    document.addEventListener("keydown", onEscape);
    return () => {
      root.style.overflow = previousOverflow;
      for (const element of siblings) element.removeAttribute("inert");
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  // Управление прячется, пока ролик идёт и зритель ничего не трогает.
  const [awake, setAwake] = useState(true);
  const idleTimer = useRef<number | undefined>(undefined);
  const wake = useCallback(() => {
    setAwake(true);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setAwake(false), IDLE_MS);
  }, []);
  useEffect(() => {
    idleTimer.current = window.setTimeout(() => setAwake(false), IDLE_MS);
    return () => window.clearTimeout(idleTimer.current);
  }, []);
  const chromeShown = awake || !playing;
  // Касание, пока управление спрятано, только показывает его (как у
  // YouTube на телефоне): иначе палец «на кнопке» ставил бы паузу.
  const chromeShownRef = useRef(chromeShown);
  useEffect(() => {
    chromeShownRef.current = chromeShown;
  }, [chromeShown]);
  const revealOnly = useRef(false);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    revealOnly.current = event.pointerType !== "mouse" && !chromeShownRef.current;
    wake();
  };

  const seek = useCallback(
    (target: number) => {
      player?.seekTo(Math.min(DURATION_IN_FRAMES - 1, Math.max(0, Math.round(target))));
    },
    [player],
  );
  const togglePlay = useCallback(() => {
    player?.toggle();
  }, [player]);
  const onStageClick = () => {
    if (revealOnly.current) {
      revealOnly.current = false;
      return;
    }
    togglePlay();
  };

  const { chapter, index, local } = chapterAt(frame);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    wake();
    const target = event.target as HTMLElement;
    if (event.key === " " || event.key === "Spacebar" || event.key === "k" || event.key === "л") {
      if (target.tagName === "BUTTON" && event.key !== "k" && event.key !== "л") return;
      event.preventDefault();
      togglePlay();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const sign = event.key === "ArrowRight" ? 1 : -1;
      if (event.shiftKey) {
        const next = (index + sign + CHAPTERS.length) % CHAPTERS.length;
        seek(CHAPTERS[next].from);
        return;
      }
      seek(frame + sign * SEEK_STEP_SECONDS * FPS);
    }
  };

  // Сегмент главы: щелчок мышью — точное место внутри главы, Enter с
  // клавиатуры (detail === 0) — начало главы.
  const onSegment = (event: ReactMouseEvent<HTMLButtonElement>, chapterIndex: number) => {
    const item = CHAPTERS[chapterIndex];
    if (event.detail === 0) {
      seek(item.from);
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const share = box.width > 0 ? Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) : 0;
    seek(item.from + share * (item.duration - 1));
  };

  const chromeClass = `transition-opacity duration-200 motion-reduce:transition-none ${chromeShown ? "opacity-100" : "pointer-events-none opacity-0"}`;

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("chrome.fullscreenLabel")}
      tabIndex={-1}
      data-qr-fullscreen=""
      onKeyDown={onKeyDown}
      onPointerMove={(event) => {
        if (event.pointerType === "mouse") wake();
      }}
      onPointerDown={onPointerDown}
      className="fixed inset-0 z-[200] h-[100dvh] w-full overflow-hidden bg-[#05070f] text-white outline-none"
      style={{ cursor: chromeShown ? undefined : "none" }}
    >
      {/* Сцена: вписана в свободное место, сверху и снизу — поля под
          управление; на низком экране (телефон лёжа) управление ложится
          поверх кадра и прячется само. */}
      <div
        className={`absolute inset-0 pt-[64px] ${portraitPhone ? "pb-[124px]" : "pb-[92px] sm:pb-[100px]"} [@media(max-height:520px)]:py-0`}
      >
        <div className="relative h-full w-full" style={{ containerType: "size" }}>
          <div
            data-qr-fullscreen-stage=""
            onClick={onStageClick}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer overflow-hidden rounded-none sm:rounded-2xl"
            style={{
              width: `min(100cqw, 100cqh * ${ratio})`,
              height: `min(100cqh, 100cqw / ${ratio})`,
              background: STAGE_BACKGROUND,
            }}
          >
            <Player
              ref={playerRef}
              component={QrComposition}
              inputProps={{ fridgeTemp, bodyTemp, today, qr }}
              durationInFrames={DURATION_IN_FRAMES}
              fps={FPS}
              compositionWidth={composition.width}
              compositionHeight={composition.height}
              loop
              controls={false}
              clickToPlay={false}
              numberOfSharedAudioTags={0}
              acknowledgeRemotionLicense
              style={{ width: "100%", height: "100%" }}
            />
            {!playing ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-white shadow-[0_18px_40px_-16px_rgba(0,0,0,0.8)] md:size-20"
                style={{ background: "rgba(85,102,246,0.92)" }}
              >
                <Play className="size-7 translate-x-0.5 md:size-8" fill="currentColor" />
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Шапка: глава и «закрыть». */}
      <div
        className={`absolute inset-x-0 top-0 z-20 flex items-center gap-3 bg-gradient-to-b from-[#05070f] via-[#05070f]/80 to-transparent px-3 pb-3 pt-[max(10px,env(safe-area-inset-top))] sm:px-5 ${chromeClass}`}
      >
        <div className="flex min-w-0 items-center gap-2 text-[14px] font-medium sm:text-[15px]">
          <span
            className="inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-[13px] font-semibold tabular-nums text-[#141a44]"
            style={{ background: chapter.accentSoft, color: chapter.accent }}
          >
            {index + 1}
          </span>
          <span className="truncate">{chapterLabels[chapter.id]}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {extraAction}
          <button
            type="button"
            onClick={close}
            aria-label={t("chrome.close")}
            title={t("chrome.close")}
            className="flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-150 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8b97ff]/50"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>

      {/* Низ: пауза, главы-сегменты, время. */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#05070f] via-[#05070f]/80 to-transparent px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-6 sm:px-5 ${chromeClass}`}
      >
        {portraitPhone ? (
          <p className="mb-2.5 flex items-center justify-center gap-2 text-[12.5px] text-white/70">
            <Smartphone className="size-4 rotate-90 text-[#8b97ff]" aria-hidden="true" />
            {t("chrome.rotateHint")}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? t("chrome.pause") : t("chrome.play")}
            title={playing ? t("chrome.pause") : t("chrome.play")}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.8)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8b97ff]/50"
          >
            {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4 translate-x-px" fill="currentColor" />}
          </button>
          <div role="group" aria-label={t("chrome.seek")} className="flex min-w-0 flex-1 gap-1 sm:gap-1.5">
            {CHAPTERS.map((item, chapterIndex) => {
              const current = chapterIndex === index;
              const fill = chapterIndex < index ? 1 : current ? local / item.duration : 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={(event) => onSegment(event, chapterIndex)}
                  aria-current={current ? "step" : undefined}
                  aria-label={t("chrome.chapterSeek", { chapterNumber: chapterIndex + 1, chapterName: chapterLabels[item.id] })}
                  className="group/segment flex min-w-0 flex-1 flex-col gap-1.5 rounded-md py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b97ff]/60"
                >
                  <span className="relative block h-1.5 w-full overflow-hidden rounded-full bg-white/20 transition-[height] duration-150 group-hover/segment:h-2">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${fill * 100}%`, background: current ? item.accent : "rgba(255,255,255,0.85)" }}
                    />
                  </span>
                  <span
                    className={`hidden truncate text-[11.5px] leading-none sm:block ${current ? "font-medium text-white" : "text-white/55 group-hover/segment:text-white/80"}`}
                  >
                    {chapterLabels[item.id]}
                  </span>
                </button>
              );
            })}
          </div>
          <span className="hidden shrink-0 text-[12.5px] font-medium tabular-nums text-white/70 sm:inline">
            {formatClock(frame / FPS)} / {formatClock(DURATION_IN_FRAMES / FPS)}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
