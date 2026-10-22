import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { DEFAULT_PIPELINE_FIELDS } from "@/lib/journal-default-pipelines";
import { HEALTH_CONFIRMATIONS, healthDecision } from "@/lib/health-qr";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import messages from "@/i18n/messages/ru.json";

import { formatClock, interpolate } from "./clock";
import {
  BODY_RANGE,
  CHAPTERS,
  CHAPTER_FRAMES,
  CHAPTER_SECONDS,
  DURATION_IN_FRAMES,
  FPS,
  FRIDGE_RANGE,
  FRYER_FIELDS,
  JOURNALS,
  PDF,
  RESULT_SECONDS,
  UI,
  UI_SOURCES,
  TIME_SCALE,
  bodyFever,
  chapterAt,
  finalFrameOf,
  fridgeOutOfRange,
  resultFrameOf,
  sceneFrame,
  sceneSeconds,
} from "./chapters";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

test("шесть глав по 8 с, ролик 0:48", () => {
  assert.deepEqual(
    CHAPTERS.map((chapter) => chapter.id),
    ["fridge", "locker", "uv", "fryer", "forgot", "sensor"]
  );
  assert.equal(CHAPTER_FRAMES, 8 * FPS);
  for (const chapter of CHAPTERS) assert.equal(chapter.duration, CHAPTER_FRAMES);
  assert.equal(formatClock(DURATION_IN_FRAMES / FPS), "0:48");
  assert.equal(formatClock(7.9), "0:07");
});

test("темп одной константой: сцена 6 с растянута на 8 с равномерно", () => {
  assert.equal(TIME_SCALE, 0.75);
  assert.equal(sceneSeconds(0), 0);
  assert.equal(sceneSeconds(CHAPTER_FRAMES), CHAPTER_SECONDS);
  assert.equal(sceneSeconds(CHAPTER_FRAMES / 2), CHAPTER_SECONDS / 2);
  assert.equal(sceneFrame(CHAPTER_SECONDS), CHAPTER_FRAMES);
  for (const seconds of [0.3, 1, 2.5, RESULT_SECONDS]) {
    assert.ok(Math.abs(sceneSeconds(sceneFrame(seconds)) - seconds) <= TIME_SCALE / FPS, String(seconds));
  }
  for (let index = 0; index < CHAPTERS.length; index += 1) {
    assert.equal(resultFrameOf(index), CHAPTERS[index].from + sceneFrame(RESULT_SECONDS));
  }
});

test("кадр — функция времени: chapterAt и finalFrameOf детерминированы", () => {
  assert.deepEqual(chapterAt(0), { chapter: CHAPTERS[0], index: 0, local: 0 });
  assert.equal(chapterAt(CHAPTER_FRAMES + 1).index, 1);
  assert.equal(chapterAt(CHAPTER_FRAMES + 1).local, 1);
  assert.equal(chapterAt(DURATION_IN_FRAMES + 50).index, CHAPTERS.length - 1);
  assert.equal(chapterAt(finalFrameOf(3)).index, 3);
  assert.ok(RESULT_SECONDS < CHAPTER_SECONDS);
});

test("хром на странице: без нижней перемотки и времени, кнопки в углу, плеер на весь экран", () => {
  const player = read("src/components/landing/qr-player/qr-player.tsx");
  assert.doesNotMatch(player, /chrome\.seek/, "перемотка под роликом убрана");
  assert.doesNotMatch(player, /formatClock/, "время «0:12 / 0:48» под роликом убрано");
  assert.doesNotMatch(player, /qrp-range-thin/, "тонкая полоса перемотки убрана");
  assert.ok(player.includes("data-qr-corner"), "кнопки в углу сцены");
  assert.ok(player.includes('t("chrome.expand")'), "кнопка «Развернуть»");
  assert.ok(player.includes("chrome.tryIt"), "«Попробуйте сами» осталось");
  assert.ok(player.includes("onClick={openExpanded}"), "нажатие на сцену открывает плеер");
  const fullscreen = read("src/components/landing/qr-player/fullscreen-player.tsx");
  for (const token of ["createPortal", "requestFullscreen", "fullscreenchange", '"Escape"', "fixed inset-0", "100dvh", "inert", 't("chrome.close")']) {
    assert.ok(fullscreen.includes(token), `fullscreen-player: ${token}`);
  }
});

test("interpolate: зажим по краям и линейность", () => {
  assert.equal(interpolate(5, [0, 10], [0, 100]), 50);
  assert.equal(interpolate(-5, [0, 10], [0, 100]), 0);
  assert.equal(interpolate(20, [0, 10], [0, 100]), 100);
  assert.equal(interpolate(20, [0, 10], [0, 100], { clamp: false }), 200);
});

test("смена помещения: у каждой главы свой цвет и существующее фото", () => {
  const seen = new Set<string>();
  for (const chapter of CHAPTERS) {
    assert.match(chapter.accent, /^#[0-9a-f]{6}$/i, chapter.id);
    assert.match(chapter.accentSoft, /^#[0-9a-f]{6}$/i, chapter.id);
    assert.match(chapter.accentFill, /^#[0-9a-f]{6}$/i, chapter.id);
    assert.ok(!seen.has(chapter.accent), `цвет ${chapter.accent} повторяется`);
    seen.add(chapter.accent);
    assert.ok(chapter.photo.startsWith("/landing/places/"), chapter.id);
    assert.ok(existsSync(path.join(ROOT, "public", chapter.photo)), `нет файла ${chapter.photo}`);
  }
});

test("движок — Remotion: Player в плеере, useCurrentFrame в композиции", () => {
  const player = read("src/components/landing/qr-player/qr-player.tsx");
  assert.ok(player.includes('from "@remotion/player"'), "нет импорта @remotion/player");
  assert.ok(player.includes("acknowledgeRemotionLicense"), "лицензия Remotion не подтверждена пропом");
  const composition = read("src/components/landing/qr-player/composition.tsx");
  assert.ok(composition.includes("useCurrentFrame"), "композиция не на useCurrentFrame");
  const clock = read("src/components/landing/qr-player/clock.ts");
  assert.ok(clock.includes('from "remotion"'), "тайминги не на remotion");
  const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
  assert.equal(pkg.dependencies.remotion, pkg.dependencies["@remotion/player"], "версии remotion и @remotion/player должны совпадать");
});

test("журналы в сценах — ровно из каталога", () => {
  const names = new Set<string>(ACTIVE_JOURNAL_CATALOG.map((item) => item.name));
  for (const name of Object.values(JOURNALS)) assert.ok(names.has(name), name);
  for (const chapter of CHAPTERS) assert.ok(names.has(chapter.journal), chapter.journal);
});

test("короткая подпись главы: есть, одна строка, короче полной", () => {
  for (const chapter of CHAPTERS) {
    assert.ok(chapter.short.length > 0, chapter.id);
    assert.ok(chapter.short.length <= 80, `«${chapter.short}» длиннее 80 знаков`);
    assert.ok(chapter.short.length < chapter.caption.length, chapter.id);
  }
});

test("тексты экранов взяты из настоящих QR-форм", () => {
  const localized: Partial<Record<keyof typeof UI, string>> = {
    equipment: messages.equipmentFill.common.equipment,
    equipmentWho: messages.equipmentFill.employee.label,
    saveReading: messages.equipmentFill.reading.save,
    written: messages.equipmentFill.common.recorded,
    tempOut: messages.equipmentFill.reading.temperatureOutside,
    managerWillKnow: messages.equipmentFill.reading.managerNotified,
    uvWho: messages.equipmentFill.uv.operator,
    uvOn: messages.equipmentFill.uv.switchOn,
    uvOff: messages.equipmentFill.uv.switchOff,
    uvOnDone: messages.equipmentFill.uv.onTitle,
    uvOffDone: messages.equipmentFill.uv.offTitle,
  };
  const excerpts: Partial<Record<keyof typeof UI, string>> = {
    readingOutDone: messages.equipmentFill.reading.deviationSaved,
    uvRemaining: messages.equipmentFill.uv.remaining,
  };
  for (const [key, text] of Object.entries(UI)) {
    const caption = key as keyof typeof UI;
    if (localized[caption] !== undefined) {
      assert.equal(localized[caption], text, key);
      continue;
    }
    if (excerpts[caption] !== undefined) {
      assert.ok(excerpts[caption]!.startsWith(text), key);
      continue;
    }
    const file = UI_SOURCES[key as keyof typeof UI];
    assert.ok(read(file).includes(text), `«${text}» нет в ${file}`);
  }
});

test("подписи граф бланков — как в генераторе PDF", () => {
  const pdf = read("src/lib/document-pdf.ts");
  const localized = {
    stamp: messages.journalPdf.system,
    coldName: messages.coldEquipment.print.equipmentName,
    coldTemp: messages.coldEquipment.print.temperature,
    coldResponsible: messages.coldEquipment.print.responsible,
    uvDate: messages.trackedUvPdf.uv_date,
    uvOn: messages.trackedUvPdf.uv_on,
    uvOff: messages.trackedUvPdf.uv_off,
    uvTotal: messages.trackedUvPdf.uv_total,
    uvWho: messages.trackedUvPdf.uv_responsible,
    uvStampLabel: messages.trackedUvPdf.uv_fullTitle,
    fryerStart: messages.fryerOil.pdfDateStartTime,
    fryerFat: messages.fryerOil.pdfFat,
    fryerQualityStart: messages.fryerOil.pdfQualityStart,
    fryerEquipment: messages.fryerOil.pdfEquipment,
    fryerProduct: messages.fryerOil.pdfProduct,
    fryerEnd: messages.fryerOil.pdfEndTime,
    fryerQualityEnd: messages.fryerOil.pdfQualityEnd,
    fryerLeftover: messages.fryerOil.pdfRemainingOil,
    fryerCarry: messages.fryerOil.pdfCarryover,
    fryerDisposed: messages.fryerOil.pdfDisposed,
    fryerController: messages.fryerOil.pdfController,
  };
  for (const [key, label] of Object.entries(PDF)) {
    if (key in localized) {
      assert.equal(localized[key as keyof typeof localized], label, key);
    } else {
      assert.ok(pdf.includes(label), `«${label}» нет в document-pdf.ts`);
    }
  }
});

test("поля фритюра — из колонок пайплайна fryer_oil", () => {
  const labels = new Set(DEFAULT_PIPELINE_FIELDS.fryer_oil.map((field) => field.label));
  for (const label of Object.values(FRYER_FIELDS)) assert.ok(labels.has(label), label);
});

test("отклонения из «Попробуйте сами» совпадают с продуктом", () => {
  assert.equal(fridgeOutOfRange(4), false);
  assert.equal(fridgeOutOfRange(2), false);
  assert.equal(fridgeOutOfRange(6), false);
  assert.equal(fridgeOutOfRange(6.5), true);
  assert.equal(fridgeOutOfRange(1.5), true);
  assert.equal(FRIDGE_RANGE.min, -2);
  assert.equal(FRIDGE_RANGE.max, 12);

  assert.equal(bodyFever(37), false);
  assert.equal(bodyFever(37.1), true);
  assert.equal(BODY_RANGE.min, 35.8);
  // Не подписанная графа о температуре → «не допущен» тем же решением, что в QR.
  const decision = healthDecision(HEALTH_CONFIRMATIONS.filter((item) => item.key !== "temperature").map((item) => item.key));
  assert.equal(decision.admitted, false);
  assert.equal(decision.hygiene.status, "suspended");
  assert.ok(decision.complaints.includes("температура выше 37"));
});

test("напоминания 12:00 / 17:00 / 21:00 — ступени крона compliance", () => {
  const route = read("src/app/api/cron/compliance/route.ts");
  for (const hour of ["12:00", "17:00", "21:00"]) assert.ok(route.includes(hour), hour);
});

test("пресеты «Что сделали» — из формы отклонения", () => {
  const source = read("src/lib/qr-correction-presets.ts");
  const scene = read("src/components/landing/qr-player/scene.tsx");
  const russian = JSON.parse(read("src/i18n/messages/ru.json"));
  const english = JSON.parse(read("src/i18n/messages/en.json"));
  const uzbek = JSON.parse(read("src/i18n/messages/uz.json"));
  for (const [id, preset] of [["masterCalled", "Вызвал мастера"], ["productsMoved", "Переложил продукты"]]) {
    assert.ok(source.includes(preset), `preset data: ${preset}`);
    assert.ok(scene.includes(`id: "${id}"`) && scene.includes(`ui.${id}`), `scene behavior and translation key: ${id}`);
    for (const catalog of [russian, english, uzbek]) {
      assert.equal(typeof catalog.qrScene.ui[id], "string", `translated label: ${id}`);
      assert.ok(catalog.qrScene.ui[id].length > 0, `non-empty translated label: ${id}`);
    }
  }
});
