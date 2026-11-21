import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { DEFAULT_PIPELINE_FIELDS } from "@/lib/journal-default-pipelines";
import { HEALTH_CONFIRMATIONS, healthDecision } from "@/lib/health-qr";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { QUALITY_LABELS } from "@/lib/fryer-oil-document";
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
  FRYER_QUALITY,
  JOURNALS,
  PDF,
  RESULT_SECONDS,
  UI,
  UI_SOURCES,
  TIME_SCALE,
  bodyFever,
  chapterAt,
  chapterTimeline,
  finalFrameOf,
  fridgeOutOfRange,
  fryerQualityKey,
  fryerQualityPoor,
  resultFrameOf,
  sceneFrame,
  sceneSeconds,
} from "./chapters";
import { INDUSTRY_CHAPTERS } from "./industries";

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

test("«Попробуйте сами»: оценка масла — подписи как в журнале фритюрных жиров", () => {
  // Третий пример — не про температуру (правки 19.11.2026).
  assert.deepEqual({ ...FRYER_QUALITY }, { min: 1, max: 5, initial: 5 });
  for (let score = FRYER_QUALITY.min; score <= FRYER_QUALITY.max; score += 1) {
    assert.equal(messages.qrScene[fryerQualityKey(score)], QUALITY_LABELS[score], `оценка ${score}`);
    assert.equal(fryerQualityPoor(score), QUALITY_LABELS[score] === "Неудовлетворительное", `оценка ${score}`);
  }
  const player = read("src/components/landing/qr-player/qr-player.tsx");
  assert.ok(player.includes("data-qrp-try-fryer"), "пример с маслом в панели");
  assert.ok(player.includes("inputProps={{ fridgeTemp, bodyTemp, fryerQuality, today, qr, chapterIds: timeline.ids }}"), "оценка уходит в сцену");
});

test("хром 19.11.2026: стрелки глав, PDF рядом с видео, организация по-русски", () => {
  const player = read("src/components/landing/qr-player/qr-player.tsx");
  for (const token of ["data-qr-prev", "data-qr-next", 't("chrome.previousChapter")', 't("chrome.nextChapter")', "data-qr-presentation"]) {
    assert.ok(player.includes(token), token);
  }
  assert.equal(messages.qrScene.demo.org, "ООО «БФС»");
  const scene = read("src/components/landing/qr-player/scene.tsx");
  assert.doesNotMatch(scene, /DEMO\.org/, "название организации — из словаря");
  assert.equal(scene.match(/tr\("demo\.org"\)/g)?.length, 3, "шапка формы, наклейка и штамп бланка");
  // Блок на главной: три шага вместо абзаца.
  const page = read("src/app/page.tsx");
  assert.ok(page.includes("QR_SCAN_STEPS.map"), "три шага");
  assert.doesNotMatch(page, /landing\.qrScanDescription/, "абзаца-описания больше нет");
});

test("блок QR 20.11.2026: без «QR-код», шаги с жирным, плашка «без интернета», кнопки под роликом", () => {
  const page = read("src/app/page.tsx");
  assert.doesNotMatch(page, /landing\.qrEquipmentTitle/, "надстрочника «QR-код» нет");
  assert.equal((messages.landing as Record<string, unknown>).qrEquipmentTitle, undefined);
  assert.deepEqual(
    { ...messages.landing.qrScanSteps },
    {
      label: "Шаг {step, number}",
      scan: "Сотрудник **отсканировал** QR-код",
      pin: "Выбор сотрудника и **ввод PIN**",
      entry: "Ввёл данные — **запись в журнал**",
    },
  );
  assert.equal(messages.landing.qrOffline, "Может работать без интернета");
  // Плашка — после списка шагов и вне колонки max-w: во всю ширину блока.
  const steps = page.indexOf("QR_SCAN_STEPS.map");
  const offline = page.indexOf("data-qr-offline");
  const player = page.indexOf("<QrIndustryPlayer");
  assert.ok(steps > 0 && offline > steps && player > offline, "шаги → плашка → ролик");
  assert.ok(page.includes('{copy("landing.qrOffline")}'));
  // Подписи «Пример для общепита… Включите звук.» нет ни под кнопкой, ни в подсказке.
  assert.equal((messages.qrPlayer.chrome as Record<string, unknown>).watchVideoHint, undefined);
  for (const file of ["qr-player.tsx", "video-lightbox.tsx", "qr-industry-player.tsx"]) {
    assert.doesNotMatch(read(`src/components/landing/qr-player/${file}`), /watchVideoHint/, file);
  }
  // Видео и PDF — под сценой и «Попробуйте сами», а не над вкладками глав.
  const source = read("src/components/landing/qr-player/qr-player.tsx");
  const render = source.slice(source.indexOf("data-qr-player=\"\""));
  const nav = render.indexOf("<nav");
  const stage = render.indexOf("data-qr-stage");
  const tryPanel = render.indexOf('id="qrp-try-panel"');
  const media = render.indexOf("<QrMediaButtons");
  assert.ok(nav >= 0 && stage > nav && tryPanel > stage && media > tryPanel, "главы → сцена → «Попробуйте сами» → видео и PDF");
});

test("вкладки вида деятельности: у каждого свой ролик, без кухни у медцентра и отеля", () => {
  const source = read("src/components/landing/qr-player/qr-industry-player.tsx");
  assert.ok(source.includes('role="tablist"') && source.includes('role="tab"'), "вкладки");
  assert.ok(source.includes("useState<QrIndustry>(DEFAULT_QR_INDUSTRY)"), "по умолчанию — общепит");
  assert.doesNotMatch(source, /pending/i, "плашки «в разработке» больше нет");
  assert.ok(source.includes("chapterIds={INDUSTRY_CHAPTERS[active]}"), "ролик вида — свой набор глав");
  assert.ok(source.includes("video={media[active].video}") && source.includes("presentation={media[active].presentation}"), "у вида свои видео и PDF");
  // Общепит — весь ролик (0:48), у медцентра и отеля кухни нет.
  assert.deepEqual([...INDUSTRY_CHAPTERS.food], CHAPTERS.map((chapter) => chapter.id));
  for (const industry of ["medical", "hotel"] as const) {
    assert.ok(!INDUSTRY_CHAPTERS[industry].includes("fryer"), `${industry}: без фритюра`);
    assert.ok(INDUSTRY_CHAPTERS[industry].length >= 3, `${industry}: хотя бы три главы`);
  }
  // У медцентра нет раздевалки: её запись идёт в гигиенический журнал общепита.
  assert.ok(!INDUSTRY_CHAPTERS.medical.includes("locker"));
  assert.equal(INDUSTRY_CHAPTERS.medical[0], "uv", "медцентр начинается с бактерицидной лампы");
  for (const catalog of ["ru", "en", "uz"]) {
    const industries = JSON.parse(read(`src/i18n/messages/${catalog}.json`)).qrPlayer.industries;
    assert.ok(industries.label?.length > 0, `${catalog}: label`);
    assert.equal(industries.pendingBadge, undefined, `${catalog}: строк «в разработке» нет`);
    for (const id of ["food", "medical", "hotel"]) {
      for (const key of ["label", "short"]) assert.ok(industries[id]?.[key]?.length > 0, `${catalog}: ${id}.${key}`);
      assert.equal(industries[id].pending, undefined, `${catalog}: ${id}.pending убран`);
      assert.ok(industries[id].short.length <= 11, `${catalog}: «${industries[id].short}» не влезет в треть строки телефона`);
    }
  }
  assert.deepEqual(
    [messages.qrPlayer.industries.food.label, messages.qrPlayer.industries.medical.label, messages.qrPlayer.industries.hotel.label],
    ["Общепит", "Медицинский центр", "Отель"],
  );
});

test("набор глав: та же сцена, своя раскладка по времени", () => {
  const all = chapterTimeline();
  assert.equal(all.durationInFrames, DURATION_IN_FRAMES);
  assert.deepEqual(all.at(CHAPTER_FRAMES + 1), chapterAt(CHAPTER_FRAMES + 1));
  for (let index = 0; index < CHAPTERS.length; index += 1) assert.equal(all.resultFrameOf(index), resultFrameOf(index));

  const medical = chapterTimeline(INDUSTRY_CHAPTERS.medical);
  assert.equal(medical.durationInFrames, 3 * CHAPTER_FRAMES);
  assert.equal(formatClock(medical.durationInFrames / FPS), "0:24");
  assert.deepEqual(medical.at(0), { chapter: medical.chapters[0], index: 0, local: 0 });
  assert.equal(medical.at(0).chapter.id, "uv");
  // Первая глава набора — без входа «на скорости»: индекс 0, хоть в общем ролике она третья.
  assert.equal(medical.at(CHAPTER_FRAMES).chapter.id, "fridge");
  assert.equal(medical.at(CHAPTER_FRAMES).index, 1);
  assert.equal(medical.at(10 * CHAPTER_FRAMES).chapter.id, "forgot", "за концом — последняя глава");
  assert.equal(medical.resultFrameOf(1), CHAPTER_FRAMES + sceneFrame(RESULT_SECONDS));
  assert.throws(() => chapterTimeline([]), /Пустой набор/);

  // Плеер, плеер на весь экран и сцена берут раскладку из набора, а «Попробуйте сами»
  // показывает только примеры глав этого ролика.
  const player = read("src/components/landing/qr-player/qr-player.tsx");
  assert.ok(player.includes("chapterIds: timeline.ids"), "набор уходит в композицию");
  assert.ok(player.includes("chapterIds={timeline.ids}"), "и в плеер на весь экран");
  for (const token of ["fridgeIndex >= 0 ? <TrySlider", "lockerIndex >= 0 ? <TrySlider", "fryerIndex >= 0 ? <div", "tryExamples > 0 ? <button"]) {
    assert.ok(player.includes(token), token);
  }
  assert.doesNotMatch(player, /showResult\(\d\)/, "итог примера — по месту главы в наборе, не по номеру");
  assert.ok(read("src/components/landing/qr-player/fullscreen-player.tsx").includes("chapterTimeline(chapterIds)"));
  assert.ok(read("src/components/landing/qr-player/scene.tsx").includes("chapterTimeline(chapterIds).at(frame)"));
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
