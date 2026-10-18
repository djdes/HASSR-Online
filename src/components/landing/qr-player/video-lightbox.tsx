"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal, flushSync } from "react-dom";
import { Play, Volume2, X } from "lucide-react";

/**
 * Видео «Как работает QR» с голосом (`npm run video:render`): кнопка
 * «Смотреть видео со звуком» и плеер.
 *
 * - Телефон (грубый указатель): нажатие сразу открывает нативный полный
 *   экран видео — `requestFullscreen()` (Android), на iPhone —
 *   `webkitEnterFullscreen()`. Вызов идёт в том же нажатии (через
 *   `flushSync` элемент уже в DOM), иначе браузер полный экран и звук не
 *   даст. Не вышло — остаётся тёмный слой на весь экран с тем же видео.
 * - Компьютер: окно в нашем стиле с `<video controls playsInline poster>`;
 *   Esc, крестик и щелчок мимо окна закрывают.
 *
 * До нажатия `<video>` нет на странице, у самого видео `preload="none"`:
 * файл не грузится, пока зритель не попросил.
 */

export type NarratedVideo = {
  /** `/landing/video/qr-tour-ru.mp4` */
  src: string;
  poster?: string;
  /** WebVTT: субтитры уже в кадре, дорожка — для тех, кому нужен текст. */
  captions?: string;
};

type Mode = "dialog" | "native";
type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/** Эти дети body не рисуются — `inert` им не нужен. */
const NON_VISUAL = new Set(["SCRIPT", "STYLE", "LINK", "NOSCRIPT", "TEMPLATE"]);

/** Полный экран и звук — только в обработчике нажатия. */
function enterNativeFullscreen(node: WebkitVideo) {
  const playing = node.play();
  playing?.catch(() => undefined);
  if (document.fullscreenEnabled && typeof node.requestFullscreen === "function") {
    node.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
    return;
  }
  if (typeof node.webkitEnterFullscreen === "function") {
    try {
      node.webkitEnterFullscreen();
    } catch {
      // До метаданных iPhone полный экран не даёт — входим, как только видео пошло.
      playing?.then(() => node.webkitEnterFullscreen?.()).catch(() => undefined);
    }
  }
}

export function WatchVideoButton({ video, onOpenChange }: { video: NarratedVideo; onOpenChange?: (open: boolean) => void }) {
  const t = useTranslations("qrPlayer");
  const [mode, setMode] = useState<Mode | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const open = () => {
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (!coarse) {
      setMode("dialog");
      onOpenChange?.(true);
      return;
    }
    flushSync(() => setMode("native"));
    onOpenChange?.(true);
    if (videoRef.current) enterNativeFullscreen(videoRef.current);
  };

  const close = useCallback(() => {
    setMode(null);
    onOpenChange?.(false);
  }, [onOpenChange]);

  // Фокус — обратно на кнопку, когда слой снят и со страницы убран `inert`.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (mode) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    buttonRef.current?.focus({ preventScroll: true });
  }, [mode]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        title={t("chrome.watchVideoHint")}
        data-qr-video-button=""
        className="group inline-flex h-12 shrink-0 items-center gap-3 rounded-2xl bg-white/[0.08] pl-1.5 pr-4 text-[15px] font-medium text-white ring-1 ring-inset ring-white/15 transition-colors duration-150 hover:bg-white/[0.14] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8b97ff]/50 sm:pr-5"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.8)] transition-colors duration-150 group-hover:bg-[#4a5bf0]">
          <Play className="size-4 translate-x-px" fill="currentColor" aria-hidden="true" />
        </span>
        {t("chrome.watchVideo")}
        <Volume2 className="size-4 text-[#8b97ff]" aria-hidden="true" />
      </button>
      {mode ? <VideoLightbox video={video} mode={mode} videoRef={videoRef} onClose={close} /> : null}
    </>
  );
}

function VideoLightbox({
  video,
  mode,
  videoRef,
  onClose,
}: {
  video: NarratedVideo;
  mode: Mode;
  videoRef: RefObject<HTMLVideoElement | null>;
  onClose: () => void;
}) {
  const t = useTranslations("qrPlayer");
  const hostRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeLatest = useRef(onClose);
  useEffect(() => {
    closeLatest.current = onClose;
  }, [onClose]);

  const close = useCallback(() => {
    const node = videoRef.current;
    node?.pause();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    closeLatest.current();
  }, [videoRef]);

  // Страница под слоем не прокручивается и не ловит фокус; Esc закрывает.
  useEffect(() => {
    const root = document.documentElement;
    const host = hostRef.current;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    const siblings = Array.from(document.body.children).filter(
      (element) => element !== host && !element.hasAttribute("inert") && !NON_VISUAL.has(element.tagName),
    );
    for (const element of siblings) element.setAttribute("inert", "");
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = previousOverflow;
      for (const element of siblings) element.removeAttribute("inert");
      document.removeEventListener("keydown", onKey);
    };
  }, [close]);

  // Окно на компьютере: видео сразу идёт — зритель сам нажал «Смотреть».
  useEffect(() => {
    if (mode !== "dialog") return;
    videoRef.current?.play().catch(() => undefined);
  }, [mode, videoRef]);

  // Телефон: вышли из полного экрана — закрываем и слой. Layout-эффект:
  // слушатель должен стоять до того, как браузер войдёт в полный экран.
  useLayoutEffect(() => {
    if (mode !== "native") return;
    const node = videoRef.current;
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement) {
        entered = true;
        return;
      }
      if (entered) close();
    };
    const onWebkitEnd = () => close();
    document.addEventListener("fullscreenchange", onChange);
    node?.addEventListener("webkitendfullscreen", onWebkitEnd);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      node?.removeEventListener("webkitendfullscreen", onWebkitEnd);
    };
  }, [mode, videoRef, close]);

  const track = video.captions ? <track kind="subtitles" src={video.captions} srcLang="ru" label={t("chrome.videoSubtitles")} /> : null;
  const closeButton = (
    <button
      ref={closeRef}
      type="button"
      onClick={close}
      aria-label={t("chrome.close")}
      title={t("chrome.close")}
      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors duration-150 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8b97ff]/50"
    >
      <X className="size-5" />
    </button>
  );

  if (mode === "native") {
    return createPortal(
      <div
        ref={hostRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("chrome.videoLabel")}
        data-qr-video-dialog="native"
        className="fixed inset-0 z-[210] h-[100dvh] w-full bg-black"
      >
        {/* Без playsInline: на iPhone видео само уходит в полный экран. */}
        <video ref={videoRef} src={video.src} poster={video.poster} controls preload="none" className="h-full w-full object-contain">
          {track}
        </video>
        <div className="absolute right-3 top-[max(10px,env(safe-area-inset-top))]">{closeButton}</div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={hostRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("chrome.videoLabel")}
      data-qr-video-dialog="dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="fixed inset-0 z-[210] flex h-[100dvh] w-full items-center justify-center bg-[#05070f]/85 p-4 backdrop-blur-sm animate-in fade-in-0 duration-200 motion-reduce:animate-none sm:p-8"
    >
      <div
        className="relative max-w-full overflow-hidden rounded-3xl bg-[#05070f] text-white shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/10 animate-in zoom-in-95 duration-200 motion-reduce:animate-none"
        style={{ width: "min(1100px, calc((100dvh - 8.5rem) * 16 / 9))" }}
      >
        <div className="flex items-center gap-3 py-2.5 pl-4 pr-2.5 sm:pl-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#5566f6]/15 text-[#8b97ff]">
            <Volume2 className="size-[18px]" aria-hidden="true" />
          </span>
          <p className="min-w-0 flex-1 truncate text-[15px] font-medium">{t("chrome.videoLabel")}</p>
          {closeButton}
        </div>
        <video
          ref={videoRef}
          src={video.src}
          poster={video.poster}
          controls
          playsInline
          preload="none"
          className="block aspect-video w-full bg-black"
        >
          {track}
        </video>
      </div>
    </div>,
    document.body,
  );
}
