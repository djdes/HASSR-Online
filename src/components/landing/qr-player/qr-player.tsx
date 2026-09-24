"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Pause, Play, SlidersHorizontal, Thermometer, Refrigerator } from "lucide-react";

import { usePrefersReducedMotion } from "@/lib/use-media-query";

import { formatClock, useOnScreen, usePlayerClock } from "./clock";
import {
  BODY_RANGE,
  CHAPTERS,
  DURATION_IN_FRAMES,
  FPS,
  FRIDGE_NORM,
  FRIDGE_RANGE,
  RESULT_SECONDS,
  bodyFever,
  chapterAt,
  finalFrameOf,
  formatDecimal,
  fridgeOutOfRange,
} from "./chapters";
import { STAGE_BACKGROUND, SceneFrame, type SceneDay } from "./scene";
import type { QrMatrix } from "./qr-sticker";

/**
 * Интерактивный ролик «как работает QR» — механика Remotion Player своим
 * кодом: часы кадров, главы, скраббер, «Попробуйте сами» (значение меняет
 * исход сцены). Первый кадр рисуется на сервере; ролик идёт сам только в
 * зоне видимости и на видимой вкладке. При `prefers-reduced-motion` —
 * без автозапуска: раскадровка из итоговых кадров глав.
 *
 * Раскладка — минимум текста вокруг сцены: вкладки-главы одной строкой
 * НАД сценой (заливка активной = прогресс слайда), тонкая перемотка под
 * ней, одна короткая подпись, «Попробуйте сами» — свёрнут по умолчанию.
 */

const SEEK_STEP_SECONDS = 2;

export function QrPlayer({ qr, today }: { qr: QrMatrix; today: SceneDay }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const onScreen = useOnScreen(rootRef);
  const clock = usePlayerClock({ fps: FPS, durationInFrames: DURATION_IN_FRAMES, active: onScreen });
  const [fridgeTemp, setFridgeTemp] = useState<number>(FRIDGE_RANGE.initial);
  const [bodyTemp, setBodyTemp] = useState<number>(BODY_RANGE.initial);
  const [tryOpen, setTryOpen] = useState(false);
  const autoStarted = useRef(false);
  const { play, pause, seek } = clock;

  // Автозапуск — один раз, когда ролик впервые попал в кадр. Если зритель
  // поставил паузу, прокрутка туда-обратно его решение не отменяет.
  useEffect(() => {
    if (!onScreen || reduced || autoStarted.current) return;
    autoStarted.current = true;
    play();
  }, [onScreen, reduced, play]);

  // reduced-motion: стоим на итоговом кадре главы — это раскадровка.
  useEffect(() => {
    if (!reduced) return;
    pause();
    seek(finalFrameOf(0));
  }, [reduced, pause, seek]);

  const { chapter, index, local } = chapterAt(clock.frame);
  const storyboard = reduced && !clock.playing;

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
    seek(storyboard ? finalFrameOf(next) : CHAPTERS[next].from);
  };

  const showResult = (chapterIndex: number) => {
    pause();
    seek(CHAPTERS[chapterIndex].from + Math.round(RESULT_SECONDS * FPS));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.dataset.tryIt === "1") return;
    if (event.key === " " || event.key === "Spacebar") {
      if (target.tagName === "BUTTON") return;
      event.preventDefault();
      clock.toggle();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const sign = event.key === "ArrowRight" ? 1 : -1;
      if (event.shiftKey) {
        goToChapter(index + sign);
        return;
      }
      seek(Math.min(DURATION_IN_FRAMES - 1, Math.max(0, clock.frame + sign * SEEK_STEP_SECONDS * FPS)));
    }
  };

  const tickPercents = CHAPTERS.slice(1).map((item) => (item.from / (DURATION_IN_FRAMES - 1)) * 100);
  const fridgeBad = fridgeOutOfRange(fridgeTemp);
  const fever = bodyFever(bodyTemp);

  return (
    <div ref={rootRef} onKeyDown={onKeyDown} data-qr-player="" data-frame={clock.frame} data-playing={clock.running ? "1" : "0"}>
      {/* Вкладки-главы: одна строка со скроллом, заливка = прогресс слайда. */}
      <nav aria-label="Главы ролика" className="mb-3">
        <div ref={tabsRef} className="qrp-tabs relative -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
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
                style={{ background: current ? "#f2f4ff" : "rgba(255,255,255,0.07)" }}
              >
                {current ? (
                  <span aria-hidden="true" className="absolute inset-y-0 left-0 -z-10" style={{ width: `${fill * 100}%`, background: "#dfe3ff" }} />
                ) : null}
                <span className="tabular-nums opacity-60">{chapterIndex + 1}</span>
                {item.chip}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Сцена: фиксированные пропорции — 4:5 на телефоне, 16:9 от md. */}
      <div
        tabIndex={0}
        data-qr-stage=""
        role="group"
        aria-roledescription="ролик"
        aria-label={`Ролик «Как работает QR», глава ${index + 1} из ${CHAPTERS.length}: ${chapter.chip}. Пробел — пауза, стрелки — перемотка.`}
        onClick={() => clock.toggle()}
        className="relative aspect-[4/5] w-full cursor-pointer overflow-hidden rounded-2xl @container focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8b97ff]/60 md:aspect-video"
        style={{
          background: STAGE_BACKGROUND,
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.07) 1px, transparent 0), radial-gradient(120% 90% at 0% 0%, rgba(85,102,246,0.28), transparent 60%), radial-gradient(90% 80% at 100% 100%, rgba(122,92,255,0.22), transparent 60%)",
          backgroundSize: "22px 22px, 100% 100%, 100% 100%",
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
        }}
      >
        <div aria-hidden="true" className="absolute inset-0">
          <SceneFrame frame={clock.frame} fridgeTemp={fridgeTemp} bodyTemp={bodyTemp} today={today} qr={qr} />
        </div>
        {/* Большая кнопка — только на обложке (кадр 0 на паузе). */}
        {!clock.playing && !storyboard && clock.frame === 0 ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-1/2 flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-white shadow-[0_18px_40px_-16px_rgba(0,0,0,0.8)] md:size-20"
            style={{ background: "rgba(85,102,246,0.92)" }}
          >
            <Play className="size-7 translate-x-0.5 md:size-8" fill="currentColor" />
          </span>
        ) : null}
      </div>

      {/* Тонкая перемотка вплотную под сценой: полоса с метками глав,
          бегунок проявляется на hover/focus. */}
      <div className="relative mt-3">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-[6px] top-1/2 h-[5px] -translate-y-1/2">
          {tickPercents.map((percent) => (
            <span key={percent} className="absolute top-0 h-full w-[2px] -translate-x-1/2 rounded-full" style={{ left: `${percent}%`, background: "rgba(255,255,255,0.35)" }} />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={DURATION_IN_FRAMES - 1}
          step={1}
          value={clock.frame}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Перемотка"
          aria-valuetext={`${formatClock(clock.frame / FPS)} из ${formatClock(DURATION_IN_FRAMES / FPS)}, глава «${chapter.chip}»`}
          className="qrp-range qrp-range-thin relative block w-full"
          style={{ ["--qrp-fill" as string]: `${(clock.frame / (DURATION_IN_FRAMES - 1)) * 100}%` }}
        />
      </div>

      {/* Одна строка: пауза, время, короткая подпись главы, спойлер. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button
          type="button"
          onClick={clock.toggle}
          aria-label={clock.playing ? "Пауза" : "Смотреть"}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.8)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8b97ff]/50"
        >
          {clock.playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4 translate-x-px" fill="currentColor" />}
        </button>
        <span className="shrink-0 text-[12.5px] font-medium tabular-nums text-white/60">
          {formatClock(clock.frame / FPS)} / {formatClock(DURATION_IN_FRAMES / FPS)}
        </span>
        <p className="order-last w-full text-[13.5px] leading-[1.5] text-white/75 sm:order-none sm:w-auto sm:min-w-0 sm:flex-1">
          {storyboard ? `Раскадровка ${index + 1}/${CHAPTERS.length}. ${chapter.caption}` : chapter.short}
        </p>
        <button
          type="button"
          onClick={() => setTryOpen((value) => !value)}
          aria-expanded={tryOpen}
          aria-controls="qrp-try-panel"
          className="ms-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium text-white/85 transition-colors duration-150 hover:bg-[rgba(255,255,255,0.12)] hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8b97ff]/50 sm:ms-0"
          style={{ background: "rgba(255,255,255,0.07)" }}
        >
          <SlidersHorizontal className="size-4 text-[#7cf5c0]" />
          Попробуйте сами
          <ChevronDown className={`size-3.5 transition-transform duration-150 ${tryOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Спойлер: оба ползунка сразу — сдвиг перематывает на итог своей
          главы. Свёрнут по умолчанию, чтобы под роликом было пусто. */}
      <div
        id="qrp-try-panel"
        data-qrp-try=""
        hidden={!tryOpen}
        className="mt-3 rounded-2xl border border-[rgba(255,255,255,0.12)] p-4"
        style={{ background: "rgba(255,255,255,0.04)" }}
      >
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <TrySlider
            icon="fridge"
            label="Температура в холодильнике"
            value={fridgeTemp}
            min={FRIDGE_RANGE.min}
            max={FRIDGE_RANGE.max}
            step={FRIDGE_RANGE.step}
            display={`${formatDecimal(fridgeTemp)} °C`}
            bad={fridgeBad}
            verdict={
              fridgeBad
                ? `Вне нормы +${FRIDGE_NORM.min}…+${FRIDGE_NORM.max} °C: строка в журнале красная, ответственный получает уведомление.`
                : `В норме +${FRIDGE_NORM.min}…+${FRIDGE_NORM.max} °C: замер ложится в журнал.`
            }
            onChange={(value) => {
              setFridgeTemp(value);
              showResult(0);
            }}
          />
          <TrySlider
            icon="body"
            label="Термометр в раздевалке"
            value={bodyTemp}
            min={BODY_RANGE.min}
            max={BODY_RANGE.max}
            step={BODY_RANGE.step}
            display={`${formatDecimal(bodyTemp)} °C`}
            bad={fever}
            verdict={
              fever
                ? "Выше 37 °C: графу про температуру не подписать — «не допущен», заведующей уходит уведомление."
                : "До 37 °C: три подписи — и сотрудник допущен к работе."
            }
            onChange={(value) => {
              setBodyTemp(value);
              showResult(1);
            }}
          />
        </div>
      </div>

      {/* Для скринридера — весь ролик текстом. */}
      <div className="sr-only">
        {CHAPTERS.map((item, chapterIndex) => (
          <p key={item.id}>
            Глава {chapterIndex + 1}, {item.chip}. {item.journal}. {item.caption}
          </p>
        ))}
      </div>
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
        <label htmlFor={`qrp-try-${props.icon}`} className="flex items-center gap-1.5 text-[13.5px] text-white/80">
          <Icon className="size-4 text-[#8b97ff]" />
          {props.label}
        </label>
        <span className="text-[18px] font-semibold tabular-nums" style={{ color: props.bad ? "#ff8f86" : "#7cf5c0" }}>
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
        className="qrp-range qrp-range-try mt-2 block w-full"
        style={{ ["--qrp-fill" as string]: `${percent}%`, ["--qrp-accent" as string]: props.bad ? "#ff8f86" : "#7cf5c0" }}
      />
      <p className="mt-2 text-[13px] leading-[1.5]" style={{ color: props.bad ? "#ffb3ab" : "rgba(255,255,255,0.72)" }} aria-live="polite">
        {props.verdict}
      </p>
    </div>
  );
}
