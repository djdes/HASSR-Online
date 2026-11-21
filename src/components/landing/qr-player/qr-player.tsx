"use client";
import { useTranslations } from "next-intl";
import { useSiteLocale } from "@/components/i18n/site-locale-provider";
import { formatNumber } from "@/i18n/locales";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { ChevronDown, ChevronLeft, ChevronRight, CookingPot, FileText, Maximize2, Pause, Play, SlidersHorizontal, Thermometer, Refrigerator } from "lucide-react";

import { useMediaQuery, usePrefersReducedMotion } from "@/lib/use-media-query";

import { useOnScreen } from "./clock";
import {
  BODY_RANGE,
  FPS,
  FRIDGE_NORM,
  FRIDGE_RANGE,
  FRYER_QUALITY,
  bodyFever,
  chapterTimeline,
  fridgeOutOfRange,
  fryerQualityKey,
  fryerQualityPoor,
  type ChapterId,
} from "./chapters";
import { QrComposition } from "./composition";
import { FullscreenPlayer, type FullscreenResult } from "./fullscreen-player";
import { DESKTOP_COMPOSITION, DESKTOP_QUERY, MOBILE_COMPOSITION, usePlayerFrame, usePlayerPlaying } from "./player-state";
import { STAGE_BACKGROUND, SceneFrame, webPlaceAsset, type SceneDay } from "./scene";
import type { QrMatrix } from "./qr-sticker";
import { WatchVideoButton, type NarratedVideo } from "./video-lightbox";

/**
 * Интерактивный ролик «как работает QR» на Remotion: кадр двигает
 * `<Player>` из `@remotion/player`, картинка — композиция из scene.tsx
 * (чистая функция кадра). Хром — наш: вкладки-главы одной строкой над
 * сценой (их заливка — прогресс), две маленькие кнопки в углу сцены
 * («пауза» и «развернуть»), подпись главы и «Попробуйте сами» спойлером.
 * Нажатие на сцену открывает ролик на весь экран (`fullscreen-player.tsx`).
 * Если отрендерено видео с голосом (`video`, только русская главная), под
 * роликом — кнопка «Смотреть видео со звуком» (`video-lightbox.tsx`), справа
 * от неё — презентация в PDF (`presentation`). Вкладки вида деятельности над
 * плеером — в `qr-industry-player.tsx`. По бокам вкладок глав — стрелки
 * «предыдущая / следующая глава»: строка вкладок прокручивается, и без
 * стрелок этого не видно. «Попробуйте сами» — три примера: два ползунка
 * температуры и оценка масла во фритюре кнопками 1–5 — каждый, только если
 * его глава есть в ролике. `chapterIds` — набор глав (у медцентра и отеля
 * свой ролик из подходящих сцен); без него — все шесть.
 * Ролик идёт сам только в зоне видимости и на видимой вкладке; при
 * `prefers-reduced-motion` — без автозапуска, раскадровка из итоговых
 * кадров глав.
 */

const SEEK_STEP_SECONDS = 2;

/** Презентация рядом с кнопкой видео: полная подпись — с `sm`, на телефоне — короткая. */
export type QrPresentation = { href: string; label: string; short: string };

export function QrPlayer({
  qr,
  today,
  video = null,
  presentation = null,
  chapterIds,
}: {
  qr: QrMatrix;
  today: SceneDay;
  video?: NarratedVideo | null;
  presentation?: QrPresentation | null;
  chapterIds?: readonly ChapterId[];
}) {
  const timeline = useMemo(() => chapterTimeline(chapterIds), [chapterIds]);
  const CHAPTERS = timeline.chapters;
  const DURATION_IN_FRAMES = timeline.durationInFrames;
  const { resultFrameOf } = timeline;
  // Примеры «Попробуйте сами» — по главам ролика: итог своей главы.
  const fridgeIndex = CHAPTERS.findIndex((item) => item.id === "fridge");
  const lockerIndex = CHAPTERS.findIndex((item) => item.id === "locker");
  const fryerIndex = CHAPTERS.findIndex((item) => item.id === "fryer");
  const tryExamples = [fridgeIndex, lockerIndex, fryerIndex].filter((value) => value >= 0).length;
  const t = useTranslations("qrPlayer");
  const sceneT = useTranslations("qrScene");
  const locale = useSiteLocale();
  const temperatureLabel = (value: number) => `${formatNumber(locale, value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace("-", "−")} °C`;
  const journalName = useTranslations("journals.names");
  const chapterText: Record<ChapterId, { label: string; place: string; caption: string; short: string }> = {
    fridge: { label: sceneT("chapters.fridgeChip"), place: sceneT("chapters.fridgePlace"), caption: sceneT("chapters.fridgeCaption"), short: sceneT("chapters.fridgeShort") },
    locker: { label: sceneT("chapters.lockerChip"), place: sceneT("chapters.lockerPlace"), caption: sceneT("chapters.lockerCaption"), short: sceneT("chapters.lockerShort") },
    uv: { label: sceneT("chapters.uvChip"), place: sceneT("chapters.uvPlace"), caption: sceneT("chapters.uvCaption"), short: sceneT("chapters.uvShort") },
    fryer: { label: sceneT("chapters.fryerChip"), place: sceneT("chapters.fryerPlace"), caption: sceneT("chapters.fryerCaption"), short: sceneT("chapters.fryerShort") },
    forgot: { label: sceneT("chapters.forgotChip"), place: sceneT("chapters.forgotPlace"), caption: sceneT("chapters.forgotCaption"), short: sceneT("chapters.forgotShort") },
    sensor: { label: sceneT("chapters.sensorChip"), place: sceneT("chapters.sensorPlace"), caption: sceneT("chapters.sensorCaption"), short: sceneT("chapters.sensorShort") },
  };
  const journalCodeByChapter = {
    fridge: "cold_equipment_control",
    locker: "hygiene",
    uv: "uv_lamp_runtime",
    fryer: "fryer_oil",
    forgot: "cold_equipment_control",
    sensor: "cold_equipment_control",
  } as const satisfies Record<ChapterId, string>;
  const rootRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const onScreen = useOnScreen(rootRef);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [fridgeTemp, setFridgeTemp] = useState<number>(FRIDGE_RANGE.initial);
  const [bodyTemp, setBodyTemp] = useState<number>(BODY_RANGE.initial);
  const [fryerQuality, setFryerQuality] = useState<number>(FRYER_QUALITY.initial);
  const [tryOpen, setTryOpen] = useState(false);

  // Плеер рендерится после маунта: SSR и первый клиентский кадр отдают
  // статичную подложку с тем же кадром — расхождения разметки нет.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Фото мест подгружаются заранее, но только когда плеер на экране и
  // браузер свободен: на телефоне шесть фото сразу забивали канал первого
  // экрана (спека seo-speed-pack-2026-11).
  useEffect(() => {
    if (!onScreen) return;
    const load = () => {
      for (const item of CHAPTERS) {
        const img = new window.Image();
        img.decoding = "async";
        img.src = webPlaceAsset(item.photo);
      }
    };
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) {
      idle(load, { timeout: 4000 });
      return;
    }
    const timer = window.setTimeout(load, 2500);
    return () => window.clearTimeout(timer);
  }, [onScreen, CHAPTERS]);

  // PlayerRef через callback-ref в state: слушатели вешаются, когда
  // Плеер реально смонтирован, а не по таймеру.
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const playerRef = useCallback((instance: PlayerRef | null) => setPlayer(instance), []);

  const frame = usePlayerFrame(player);
  const playing = usePlayerPlaying(player);

  // Намерение зрителя: пауза вне экрана его не отменяет.
  const wantsPlay = useRef(false);
  const autoStarted = useRef(false);

  // Ролик на весь экран: кадр, с которого он открыт. Пока он открыт,
  // ролик на странице стоит.
  const [expandedFrom, setExpandedFrom] = useState<number | null>(null);
  const expanded = expandedFrom !== null;
  // Пока открыто видео со звуком, немой ролик на странице тоже стоит.
  const [videoOpen, setVideoOpen] = useState(false);

  // Автозапуск — один раз, когда ролик впервые попал в кадр; вне зоны
  // видимости, на фоновой вкладке и под полноэкранным плеером он стоит.
  useEffect(() => {
    if (!player) return;
    if (!onScreen || expanded || videoOpen) {
      player.pause();
      return;
    }
    if (reduced) return;
    if (!autoStarted.current) {
      autoStarted.current = true;
      wantsPlay.current = true;
    }
    if (wantsPlay.current) player.play();
  }, [player, onScreen, reduced, expanded, videoOpen]);

  // reduced-motion: стоим на итоговом кадре главы — это раскадровка.
  useEffect(() => {
    if (!reduced || !player) return;
    wantsPlay.current = false;
    player.pause();
    player.seekTo(resultFrameOf(0));
  }, [reduced, player, resultFrameOf]);

  const seek = useCallback(
    (target: number) => {
      player?.seekTo(Math.min(DURATION_IN_FRAMES - 1, Math.max(0, Math.round(target))));
    },
    [player, DURATION_IN_FRAMES]
  );

  const togglePlay = useCallback(() => {
    if (!player) return;
    wantsPlay.current = !player.isPlaying();
    player.toggle();
  }, [player]);

  const openExpanded = useCallback(() => {
    const from = player?.getCurrentFrame() ?? frame;
    player?.pause();
    setExpandedFrom(from);
  }, [player, frame]);

  const restoreFocus = useRef(false);
  const closeExpanded = useCallback(
    (result: FullscreenResult) => {
      wantsPlay.current = result.playing;
      seek(result.frame);
      restoreFocus.current = true;
      setExpandedFrom(null);
    },
    [seek]
  );
  // Фокус — на сцену, когда слой уже снят и со страницы убран `inert`.
  useEffect(() => {
    if (expanded || !restoreFocus.current) return;
    restoreFocus.current = false;
    stageRef.current?.focus({ preventScroll: true });
  }, [expanded]);

  const { chapter, index, local } = timeline.at(frame);
  const storyboard = reduced && !playing;

  // Активная вкладка сама подъезжает в видимую зону строки (только её
  // горизонтальный скролл — страницу не дёргаем).
  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    if (strip.scrollWidth <= strip.clientWidth + 4) return;
    const active = strip.querySelector<HTMLElement>("[aria-current]");
    if (!active) return;
    const target = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, target), behavior: reduced ? "auto" : "smooth" });
  }, [index, reduced]);

  const goToChapter = (target: number) => {
    const next = (target + CHAPTERS.length) % CHAPTERS.length;
    seek(storyboard ? resultFrameOf(next) : CHAPTERS[next].from);
  };

  const showResult = (chapterIndex: number) => {
    wantsPlay.current = false;
    player?.pause();
    seek(resultFrameOf(chapterIndex));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // События порталов (плеер на весь экран, окно видео) всплывают сюда по
    // дереву React: их клавиши — не для ролика на странице.
    if (!rootRef.current?.contains(target)) return;
    if (target.dataset.tryIt === "1") return;
    if (event.key === "Enter" && target === stageRef.current) {
      event.preventDefault();
      openExpanded();
      return;
    }
    if (event.key === " " || event.key === "Spacebar") {
      if (target.tagName === "BUTTON") return;
      event.preventDefault();
      togglePlay();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const sign = event.key === "ArrowRight" ? 1 : -1;
      if (event.shiftKey) {
        goToChapter(index + sign);
        return;
      }
      seek(frame + sign * SEEK_STEP_SECONDS * FPS);
    }
  };

  const fridgeBad = fridgeOutOfRange(fridgeTemp);
  const fever = bodyFever(bodyTemp);
  const oilPoor = fryerQualityPoor(fryerQuality);
  const oilLabel = sceneT(fryerQualityKey(fryerQuality));
  const composition = desktop ? DESKTOP_COMPOSITION : MOBILE_COMPOSITION;
  const chapterLabels = Object.fromEntries(CHAPTERS.map((item) => [item.id, chapterText[item.id].label])) as Record<ChapterId, string>;
  /* Кнопки в углу: с мышью — на наведении и фокусе (пока ролик стоит —
     всегда), на телефоне — всегда, но приглушённо. */
  const cornerVisibility = playing
    ? "opacity-75 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover/stage:opacity-100 group-focus-within/stage:opacity-100"
    : "opacity-100";
  const cornerButton =
    "flex size-10 items-center justify-center rounded-full bg-[rgba(11,16,36,0.62)] text-white shadow-[0_8px_24px_-10px_rgba(0,0,0,0.7)] ring-1 ring-white/15 backdrop-blur-sm transition-colors duration-150 hover:bg-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8b97ff]/60 md:size-9";

  const arrowButton =
    "flex size-10 shrink-0 items-center justify-center rounded-full bg-[rgba(255,255,255,0.1)] text-white ring-1 ring-inset ring-white/15 transition-colors duration-150 hover:bg-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8b97ff]/50";

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} data-qr-player="" data-frame={frame} data-playing={playing ? "1" : "0"}>
      {/* Вкладки-главы: одна строка со скроллом, заливка = прогресс слайда.
          Стрелки по бокам листают главы — видно, что строка длиннее экрана. */}
      <nav aria-label={t("chrome.chaptersLabel")} className="mb-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => goToChapter(index - 1)}
          aria-label={t("chrome.previousChapter")}
          title={t("chrome.previousChapter")}
          data-qr-prev=""
          className={arrowButton}
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
        <div ref={tabsRef} className="qrp-tabs relative flex min-w-0 flex-1 gap-2 overflow-x-auto px-0.5 py-1">
          {CHAPTERS.map((item, chapterIndex) => {
            const current = chapterIndex === index;
            const fill = current ? (storyboard ? 1 : local / item.duration) : 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => goToChapter(chapterIndex)}
                aria-current={current ? "step" : undefined}
                className={`relative isolate inline-flex h-9 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8b97ff]/50 ${
                  current ? "text-[#141a44]" : "text-white/80 hover:bg-[rgba(255,255,255,0.12)] hover:text-white"
                }`}
                style={{ background: current ? item.accentSoft : "rgba(255,255,255,0.07)" }}
              >
                {current ? (
                  <span aria-hidden="true" className="absolute inset-y-0 left-0 -z-10" style={{ width: `${fill * 100}%`, background: item.accentFill }} />
                ) : null}
                <span className={`tabular-nums ${current ? "font-semibold" : "opacity-60"}`} style={current ? { color: item.accent } : undefined}>
                  {chapterIndex + 1}
                </span>
                {chapterText[item.id].label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => goToChapter(index + 1)}
          aria-label={t("chrome.nextChapter")}
          title={t("chrome.nextChapter")}
          data-qr-next=""
          className={arrowButton}
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
      </nav>

      {/* Сцена: фиксированные пропорции — 4:5 на телефоне, 16:9 от md.
          Нажатие открывает ролик на весь экран. */}
      <div
        ref={stageRef}
        tabIndex={0}
        data-qr-stage=""
        role="group"
        aria-roledescription={t("chrome.videoRole")}
        aria-label={t("chrome.stageAria", {
          chapterNumber: index + 1,
          chapterCount: CHAPTERS.length,
          chapterName: chapterText[chapter.id].label,
        })}
        title={t("chrome.expand")}
        onClick={openExpanded}
        className="group/stage relative aspect-[4/5] w-full cursor-pointer overflow-hidden rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8b97ff]/60 md:aspect-video"
        style={STAGE_SURFACE_STYLE}
      >
        {/* Подложка до маунта Плеера (и в SSR-HTML): тот же кадр 0. */}
        {player === null ? (
          <div aria-hidden="true" className="absolute inset-0 @container">
            <SceneFrame frame={0} fridgeTemp={fridgeTemp} bodyTemp={bodyTemp} fryerQuality={fryerQuality} today={today} qr={qr} chapterIds={timeline.ids} />
          </div>
        ) : null}
        {mounted ? (
          <div aria-hidden="true" className="absolute inset-0">
            <Player
              ref={playerRef}
              component={QrComposition}
              inputProps={{ fridgeTemp, bodyTemp, fryerQuality, today, qr, chapterIds: timeline.ids }}
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
          </div>
        ) : null}
        {/* Большая кнопка — только на обложке (кадр 0 на паузе). */}
        {!playing && !storyboard && frame === 0 ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-white shadow-[0_18px_40px_-16px_rgba(0,0,0,0.8)] md:size-20"
            style={{ background: "rgba(85,102,246,0.92)" }}
          >
            <Play className="size-7 translate-x-0.5 md:size-8" fill="currentColor" />
          </span>
        ) : null}
        {/* Маленькие кнопки в углу сцены: пауза (движение дольше 5 с должно
            останавливаться — WCAG 2.2.2) и «на весь экран». Их нажатие не
            открывает плеер второй раз. */}
        <div
          data-qr-corner=""
          onClick={(event) => event.stopPropagation()}
          className={`absolute bottom-2.5 right-2.5 z-20 flex gap-2 transition-opacity duration-200 motion-reduce:transition-none md:bottom-3 md:right-3 ${cornerVisibility}`}
        >
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? t("chrome.pause") : t("chrome.play")}
            title={playing ? t("chrome.pause") : t("chrome.play")}
            className={cornerButton}
          >
            {playing ? <Pause className="size-3.5" fill="currentColor" /> : <Play className="size-3.5 translate-x-px" fill="currentColor" />}
          </button>
          <button type="button" onClick={openExpanded} aria-label={t("chrome.expand")} title={t("chrome.expand")} className={cornerButton}>
            <Maximize2 className="size-4" />
          </button>
        </div>
      </div>

      {/* Под сценой: подпись главы и «Попробуйте сами». Прогресс ролика
          показывают вкладки-главы, отдельной перемотки здесь нет. */}
      <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-3">
        <p className="min-w-0 flex-1 text-[13px] leading-[1.45] text-white/70 sm:truncate sm:pt-[11px]">
          {storyboard
            ? t("chrome.storyboardCaption", {
                chapterNumber: index + 1,
                chapterCount: CHAPTERS.length,
                caption: chapterText[chapter.id].caption,
              })
            : chapterText[chapter.id].short}
        </p>
        {/* Кнопка 44 px и с подписью на любой ширине (правки 19.11.2026:
            на телефоне в значок 32 px было не попасть). Нет в ролике глав
            с примерами — нет и кнопки. */}
        {tryExamples > 0 ? <button
          type="button"
          onClick={() => setTryOpen((value) => !value)}
          aria-expanded={tryOpen}
          aria-controls="qrp-try-panel"
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-[14px] font-medium text-white ring-1 ring-inset ring-white/15 transition-colors duration-150 hover:bg-[rgba(255,255,255,0.12)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8b97ff]/50"
          style={{ background: tryOpen ? "rgba(124,245,192,0.14)" : "rgba(255,255,255,0.07)" }}
        >
          <SlidersHorizontal className="size-4 text-[#7cf5c0]" />
          {t("chrome.tryIt")}
          <ChevronDown className={`size-4 transition-transform duration-150 ${tryOpen ? "rotate-180" : ""}`} />
        </button> : null}
      </div>

      {/* Спойлер: три примера сразу — сдвиг перематывает на итог своей
          главы. Свёрнут по умолчанию, чтобы под роликом было пусто. */}
      <div
        id="qrp-try-panel"
        data-qrp-try=""
        hidden={!tryOpen || tryExamples === 0}
        className="mt-2.5 rounded-2xl border border-[rgba(255,255,255,0.12)] p-4"
        style={{ background: "rgba(255,255,255,0.04)" }}
      >
        {/* `grid-cols-1` = minmax(0, 1fr): длинная подпись не раздвигает панель шире экрана. */}
        <div className={`grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 ${tryExamples > 2 ? "lg:grid-cols-3" : ""}`}>
          {fridgeIndex >= 0 ? <TrySlider
            icon="fridge"
            label={t("chrome.fridgeTemperature")}
            value={fridgeTemp}
            min={FRIDGE_RANGE.min}
            max={FRIDGE_RANGE.max}
            step={FRIDGE_RANGE.step}
            display={temperatureLabel(fridgeTemp)}
            bad={fridgeBad}
            verdict={fridgeBad ? t("chrome.fridgeOutOfRange", { min: FRIDGE_NORM.min, max: FRIDGE_NORM.max }) : t("chrome.fridgeWithinRange", { min: FRIDGE_NORM.min, max: FRIDGE_NORM.max })}
            onChange={(value) => {
              setFridgeTemp(value);
              showResult(fridgeIndex);
            }}
          /> : null}
          {lockerIndex >= 0 ? <TrySlider
            icon="body"
            label={t("chrome.lockerThermometer")}
            value={bodyTemp}
            min={BODY_RANGE.min}
            max={BODY_RANGE.max}
            step={BODY_RANGE.step}
            display={temperatureLabel(bodyTemp)}
            bad={fever}
            verdict={fever ? t("chrome.bodyTemperatureHigh") : t("chrome.bodyTemperatureNormal")}
            onChange={(value) => {
              setBodyTemp(value);
              showResult(lockerIndex);
            }}
          /> : null}
          {/* Не только температура: оценка масла во фритюре, кнопками. */}
          {fryerIndex >= 0 ? <div role="group" aria-labelledby="qrp-try-fryer-label" data-qrp-try-fryer="">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span id="qrp-try-fryer-label" className="flex min-w-0 items-center gap-2 text-[14px] text-white/85">
                <CookingPot className="size-4 shrink-0 text-[#8b97ff]" aria-hidden="true" />
                <span className="truncate">{t("chrome.fryerQuality")}</span>
              </span>
              <span
                className="shrink-0 rounded-full px-2.5 py-1 text-[14px] font-semibold"
                style={{ color: oilPoor ? "#ff8f86" : "#7cf5c0", background: oilPoor ? "rgba(255,143,134,0.12)" : "rgba(124,245,192,0.12)" }}
              >
                {oilLabel}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {Array.from({ length: FRYER_QUALITY.max - FRYER_QUALITY.min + 1 }, (_, offset) => FRYER_QUALITY.min + offset).map((score) => {
                const active = score === fryerQuality;
                return (
                  <button
                    key={score}
                    type="button"
                    data-try-it="1"
                    aria-pressed={active}
                    onClick={() => {
                      setFryerQuality(score);
                      showResult(fryerIndex);
                    }}
                    className={`flex h-11 items-center justify-center rounded-xl text-[16px] font-semibold tabular-nums ring-1 ring-inset transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8b97ff]/50 ${active ? "landing-on-light" : ""}`}
                    style={
                      active
                        ? { background: oilPoor ? "#ff8f86" : "#7cf5c0", boxShadow: "none" }
                        : { background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.85)", ["--tw-ring-color" as string]: "rgba(255,255,255,0.15)" }
                    }
                  >
                    {score}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[13px] leading-[1.45]" style={{ color: oilPoor ? "#ffb3ab" : "rgba(255,255,255,0.72)" }} aria-live="polite">
              {t(oilPoor ? "chrome.fryerQualityPoor" : "chrome.fryerQualityOk", { score: fryerQuality, label: oilLabel })}
            </p>
          </div> : null}
        </div>
      </div>

      {/* Видео с голосом и презентация — под роликом (правки 20.11.2026:
          стояли над вкладками глав). */}
      <QrMediaButtons video={video} presentation={presentation} onVideoOpenChange={setVideoOpen} />

      {/* Для скринридера — весь ролик текстом. */}
      <div className="sr-only">
        {CHAPTERS.map((item, chapterIndex) => (
          <p key={item.id}>
            {t("chrome.chapterDescription", { chapterNumber: chapterIndex + 1, chapterName: chapterText[item.id].label, journalName: journalName(journalCodeByChapter[item.id]), caption: chapterText[item.id].caption })}
          </p>
        ))}
      </div>

      {expandedFrom !== null ? (
        <FullscreenPlayer
          qr={qr}
          today={today}
          fridgeTemp={fridgeTemp}
          bodyTemp={bodyTemp}
          fryerQuality={fryerQuality}
          startFrame={expandedFrom}
          autoPlay={!reduced}
          chapterLabels={chapterLabels}
          chapterIds={timeline.ids}
          onClose={closeExpanded}
        />
      ) : null}
    </div>
  );
}

/** Фон сцены ролика. */
export const STAGE_SURFACE_STYLE = {
  background: STAGE_BACKGROUND,
  backgroundImage:
    "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.07) 1px, transparent 0), radial-gradient(120% 90% at 0% 0%, rgba(85,102,246,0.28), transparent 60%), radial-gradient(90% 80% at 100% 100%, rgba(122,92,255,0.22), transparent 60%)",
  backgroundSize: "22px 22px, 100% 100%, 100% 100%",
  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
} as const;

/** «Видео со звуком» и «PDF» одной строкой под роликом; нет ни того ни другого — строки нет. */
export function QrMediaButtons({
  video,
  presentation,
  onVideoOpenChange,
}: {
  video: NarratedVideo | null;
  presentation: QrPresentation | null;
  onVideoOpenChange?: (open: boolean) => void;
}) {
  if (!video && !presentation) return null;
  return (
    <div data-qr-media="" className="mt-4 flex flex-wrap items-center gap-2">
      {video ? <WatchVideoButton video={video} onOpenChange={onVideoOpenChange} /> : null}
      {presentation ? (
        <a
          href={presentation.href}
          target="_blank"
          rel="noopener"
          aria-label={presentation.label}
          title={presentation.label}
          data-qr-presentation=""
          className="inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl bg-white/[0.08] px-3.5 text-[15px] font-medium text-white ring-1 ring-inset ring-white/15 transition-colors duration-150 hover:bg-white/[0.14] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8b97ff]/50 sm:px-4"
        >
          <FileText className="size-[18px] text-[#8b97ff]" aria-hidden="true" />
          <span className="sm:hidden">{presentation.short}</span>
          <span className="hidden sm:inline">{presentation.label}</span>
        </a>
      ) : null}
    </div>
  );
}

function TrySlider(props: {
  icon: "fridge" | "body";
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  bad: boolean;
  verdict: string;
  onChange: (value: number) => void;
}) {
  const Icon = props.icon === "fridge" ? Refrigerator : Thermometer;
  const percent = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`qrp-try-${props.icon}`} className="flex min-w-0 items-center gap-2 text-[14px] text-white/85">
          <Icon className="size-4 shrink-0 text-[#8b97ff]" />
          <span className="truncate">{props.label}</span>
        </label>
        <span className="shrink-0 rounded-full px-2.5 py-1 text-[14px] font-semibold tabular-nums" style={{ color: props.bad ? "#ff8f86" : "#7cf5c0", background: props.bad ? "rgba(255,143,134,0.12)" : "rgba(124,245,192,0.12)" }}>
          {props.display}
        </span>
      </div>
      <input
        id={`qrp-try-${props.icon}`}
        data-try-it="1"
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
        className="qrp-range qrp-range-try mt-1 block w-full"
        style={{ ["--qrp-fill" as string]: `${percent}%`, ["--qrp-accent" as string]: props.bad ? "#ff8f86" : "#7cf5c0" }}
      />
      <p className="mt-1 text-[13px] leading-[1.45]" style={{ color: props.bad ? "#ffb3ab" : "rgba(255,255,255,0.72)" }} aria-live="polite">
        {props.verdict}
      </p>
    </div>
  );
}
