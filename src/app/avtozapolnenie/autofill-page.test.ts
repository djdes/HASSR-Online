import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, it } from "node:test";

import {
  AUTOFILL_FPS,
  AUTOFILL_SCENES,
  AUTOFILL_TOTAL_FRAMES,
  AUTOFILL_VIDEO,
  autofillVtt,
} from "@/lib/autofill-offer";

/**
 * «Журналы, которые заполняются сами» обещают только то, что делает код
 * (`.agent/tasks/growth-stage2-2026-11/spec.md`, AC6): тест сверяет каждый
 * источник страницы и ролика с его реализацией.
 */

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const page = read("src/app/avtozapolnenie/page.tsx");
const video = AUTOFILL_SCENES.map((scene) => `${scene.title} ${scene.sub}`).join("\n");
const publicFile = (src: string) => new URL(`../../../public${src}`, import.meta.url);

describe("страница и ролик «Журналы заполняются сами»", () => {
  it("датчики: раз в час в журнал, тревога руководителю точки", () => {
    assert.match(page, /Wi-Fi датчики раз в час записывают температуру и влажность в журнал/);
    assert.match(video, /Wi-Fi датчики раз в час заносят показания в журнал/);
    const cron = read("src/app/api/cron/tuya-pull/route.ts");
    assert.match(cron, /Hourly cron: pull current temperature\/humidity/);
    assert.match(read("src/lib/temperature-deviations.ts"), /руководителям этой точки и офису/);
  });

  it("накладные iiko, Диадок, СБИС → строки приёмки; решение за человеком", () => {
    assert.match(page, /Накладные iiko, Диадока и СБИС/);
    assert.deepEqual(
      [...read("src/lib/supply/to-acceptance-row.ts").matchAll(/(diadoc|saby|iiko): "([^"]+)"/g)].map((m) => m[2]),
      ["Диадок", "СБИС", "iiko"],
    );
    assert.match(read("src/lib/supply/to-acceptance-row.ts"), /температура, упаковка, органолептика, решение —\s*\n\s*\* остаётся пустым/);
    assert.match(video, /Температуру и решение вносит сотрудник/);
  });

  it("«Меркурий»: ВСД приходят сами, гасит человек", () => {
    assert.match(page, /Гасит документ человек — после настоящей приёмки/);
    assert.match(read("docs/MERCURY.md"), /\| `assisted` \*\*\(по умолчанию\)\*\* \|[^\n]*\*\*Гасит человек кнопкой\.\*\*/);
  });

  it("фото табло, «Премиум» и пробный период — как в тарифах", () => {
    assert.match(page, /Сфотографировали дисплей термометра или холодильника — показание встаёт в журнал/);
    const plans = read("src/lib/tariff-plans.ts");
    assert.match(plans, /export type PlanFeature = "photoAutofill" \| "equipmentConnect" \| "equipmentDelivery" \| "typicalPackage" \| "mercury";/);
    assert.match(plans, /case "trial":\s*\n\s*return \{[^\n]*features: \{ \.\.\.ALL_FEATURES \}/);
    assert.match(plans, /case "standard":\s*\n\s*return \{[^\n]*features: \{ \.\.\.NO_FEATURES \}/);
    assert.match(page, /Датчики, автоввод с фото и «Меркурий» — возможности тарифа «Премиум»; первые \{TRIAL_DAYS\} дней/);
  });

  it("этикетки, график смен, документы на месяц — из кода", () => {
    assert.match(page, /журнал маркировки/);
    assert.match(read("src/lib/label-prints.ts"), /Журнал маркировки \(2026-10-31\): этикетки из «Сетап помощника»/);
    assert.match(page, /Выходные, отпуска и больничные из графика сами проставляются в гигиеническом журнале/);
    assert.match(read("src/lib/staff-journal-autofill.ts"), /статус ТОЛЬКО в ГИГИЕНИЧЕСКОМ журнале/);
    assert.match(page, /Документы на следующий месяц создаются сами/);
    assert.ok(existsSync(new URL("../api/cron/auto-create-journals/route.ts", import.meta.url)));
  });

  it("за человеком остаются температура продукта, органолептика, допуск и подпись — без «типовых цифр»", () => {
    for (const item of ["Температура продукта на приёмке", "Органолептика и бракераж", "Допуск сотрудника к работе", "Подпись ответственного"]) {
      assert.ok(page.includes(item), item);
    }
    assert.match(page, /Типовых цифр «для галочки» WeSetup\s+не подставляет/);
  });

  it("ролик: 60 секунд, субтитры из сцен, файлы на месте и в лимите", () => {
    assert.equal(AUTOFILL_TOTAL_FRAMES / AUTOFILL_FPS, AUTOFILL_VIDEO.durationSeconds);
    const vtt = autofillVtt();
    assert.match(vtt, /^WEBVTT\n\n1\n00:00:00\.000 --> 00:00:05\.000\nЖурналы, которые заполняются сами\n/);
    assert.match(vtt, /00:00:55\.000 --> 00:01:00\.000\nЖурналы, которые заполняются сами\nwesetup\.ru\/avtozapolnenie\n$/);
    assert.equal(readFileSync(publicFile(AUTOFILL_VIDEO.captions), "utf8"), vtt);
    const mp4 = statSync(publicFile(AUTOFILL_VIDEO.src)).size;
    assert.ok(mp4 > 300 * 1024 && mp4 <= AUTOFILL_VIDEO.maxBytes, `mp4 ${mp4}`);
    assert.ok(statSync(publicFile(AUTOFILL_VIDEO.poster)).size > 20 * 1024);
  });

  it("страница: видео по нажатию, VideoObject, показ за 15 минут, ссылка в подвале и в sitemap", () => {
    assert.match(page, /preload="none"/);
    assert.match(page, /"@type": "VideoObject"/);
    assert.match(page, /<DemoRequestButton place="autofill" variant="onDark" \/>/);
    assert.match(page, /<HeroEmailStart place="autofill" tone="dark" align="start" \/>/);
    assert.match(read("src/components/public/public-chrome.tsx"), /href="\/avtozapolnenie"[^\n]*\{t\("autofillOffer"\)\}/);
    assert.match(read("src/app/sitemap.ts"), /\$\{SITE\}\/avtozapolnenie`/);
    assert.match(read("package.json"), /"video:render:autofill": "tsx scripts\/landing-video\/render-autofill\.ts"/);
  });
});
