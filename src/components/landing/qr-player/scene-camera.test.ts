/* eslint-disable react/no-children-prop -- Typed createElement provider calls require children in props. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import { loadMessages, pickMessages } from "@/i18n/messages";

import { CHAPTERS, CHAPTER_SECONDS, FPS, RESULT_SECONDS, chapterAt, resultFrameOf } from "./chapters";
import { SceneFrame } from "./scene";

const ROOT = process.cwd();
const scene = readFileSync(path.join(ROOT, "src/components/landing/qr-player/scene.tsx"), "utf8");

async function render(frame: number, fridgeTemp = 4) {
  const messages = pickMessages(await loadMessages("ru"), ["qrPlayer", "qrScene", "journals", "hygiene"]);
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: "ru",
      messages,
      timeZone: "Europe/Moscow",
      children: createElement(SceneFrame, {
        frame,
        fridgeTemp,
        bodyTemp: 36.6,
        today: { day: 16, month: 10, year: 2026, daysInMonth: 31, monthLabel: "октябрь 2026" },
        qr: { bare: '<svg xmlns="http://www.w3.org/2000/svg"/>', printed: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
      }),
    }),
  );
}

test("кадр — чистая функция номера кадра: одинаковый кадр даёт одинаковую разметку", async () => {
  for (const chapter of CHAPTERS) {
    for (const offset of [0, 20, 75, 130, 150, resultFrameOf(0) - CHAPTERS[0].from, chapter.duration - 1]) {
      const frame = chapter.from + offset;
      assert.equal(await render(frame), await render(frame), `${chapter.id} @ ${offset}`);
    }
  }
  assert.equal(await render(140, 12), await render(140, 12), "отклонение тоже детерминировано");
});

test("в сцене нет своих часов: ни таймеров, ни CSS-анимаций", () => {
  for (const pattern of [/setTimeout\(/, /setInterval\(/, /requestAnimationFrame\(/, /Date\.now\(/, /new Date\(\)/, /animation:/, /animationName/]) {
    assert.doesNotMatch(scene, pattern, String(pattern));
  }
});

test("пример с телефоном и холодильником — сверху, журнал — снизу (обе раскладки)", () => {
  const block = scene.slice(scene.indexOf("const POS = {"), scene.indexOf("} as const;", scene.indexOf("const POS = {")));
  const pos = (name: string) => {
    const match = block.match(new RegExp(`\\n  ${name}: "([^"]+)"`));
    assert.ok(match, `нет POS.${name}`);
    return match[1];
  };
  const top = (classes: string, variant: "mobile" | "desktop") => {
    const tokens = classes.split(/\s+/);
    const desktop = tokens.find((token) => token.startsWith("md:top-["));
    const mobile = tokens.find((token) => token.startsWith("top-["));
    const token = variant === "desktop" ? desktop ?? mobile : mobile;
    assert.ok(token, `${classes}: нет top для ${variant}`);
    return Number(token.replace(/^(md:)?top-\[/, "").replace("%]", ""));
  };
  for (const variant of ["mobile", "desktop"] as const) {
    assert.ok(top(pos("phone"), variant) < top(pos("paper"), variant), `${variant}: телефон выше журнала`);
    assert.ok(top(pos("rail"), variant) < top(pos("paper"), variant), `${variant}: шаги выше журнала`);
  }
});

test("раскадровка reduced-motion стоит на итоге главы, до склейки на следующую", () => {
  for (let index = 0; index < CHAPTERS.length; index += 1) {
    const frame = resultFrameOf(index);
    assert.equal(chapterAt(frame).index, index);
    assert.ok(chapterAt(frame).local / FPS < CHAPTER_SECONDS - 0.2, `${CHAPTERS[index].id}: итог раньше склейки`);
  }
  assert.ok(RESULT_SECONDS < CHAPTER_SECONDS - 0.2);
});
