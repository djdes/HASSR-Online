import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { DEFAULT_PIPELINE_FIELDS } from "@/lib/journal-default-pipelines";
import { HEALTH_CONFIRMATIONS, healthDecision } from "@/lib/health-qr";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";

import { formatClock, interpolate } from "./clock";
import {
  BODY_RANGE,
  CHAPTERS,
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
  bodyFever,
  chapterAt,
  finalFrameOf,
  fridgeOutOfRange,
} from "./chapters";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

test("шесть глав по ~6 с, ролик 0:36", () => {
  assert.deepEqual(
    CHAPTERS.map((chapter) => chapter.id),
    ["fridge", "locker", "uv", "fryer", "forgot", "sensor"]
  );
  for (const chapter of CHAPTERS) assert.equal(chapter.duration, CHAPTER_SECONDS * FPS);
  assert.equal(formatClock(DURATION_IN_FRAMES / FPS), "0:36");
  assert.equal(formatClock(7.9), "0:07");
});

test("кадр — функция времени: chapterAt и finalFrameOf детерминированы", () => {
  assert.deepEqual(chapterAt(0), { chapter: CHAPTERS[0], index: 0, local: 0 });
  assert.equal(chapterAt(181).index, 1);
  assert.equal(chapterAt(181).local, 1);
  assert.equal(chapterAt(DURATION_IN_FRAMES + 50).index, CHAPTERS.length - 1);
  assert.equal(chapterAt(finalFrameOf(3)).index, 3);
  assert.ok(RESULT_SECONDS * FPS < CHAPTER_SECONDS * FPS);
});

test("interpolate: зажим по краям и линейность", () => {
  assert.equal(interpolate(5, [0, 10], [0, 100]), 50);
  assert.equal(interpolate(-5, [0, 10], [0, 100]), 0);
  assert.equal(interpolate(20, [0, 10], [0, 100]), 100);
  assert.equal(interpolate(20, [0, 10], [0, 100], { clamp: false }), 200);
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
  for (const [key, text] of Object.entries(UI)) {
    const file = UI_SOURCES[key as keyof typeof UI];
    assert.ok(read(file).includes(text), `«${text}» нет в ${file}`);
  }
});

test("подписи граф бланков — как в генераторе PDF", () => {
  const pdf = read("src/lib/document-pdf.ts");
  for (const label of Object.values(PDF)) assert.ok(pdf.includes(label), `«${label}» нет в document-pdf.ts`);
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
  const source = read("src/components/qr-fill/deviation-correction.tsx");
  const scene = read("src/components/landing/qr-player/scene.tsx");
  for (const chip of ["Вызвал мастера", "Переложил продукты"]) {
    assert.ok(source.includes(chip) && scene.includes(chip), chip);
  }
});
