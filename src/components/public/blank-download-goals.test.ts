import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadMessages } from "../../i18n/messages";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// Окно скачивания шаблона (спека emails-preheader-text-root-catalog-2026-11-21):
// цель Метрики, когда сервер просит «Я не робот», и подсказка поля компании,
// которая не обрезается на телефоне.

test("цель blank_download_challenge — при каждом запросе проверки, в обоих окнах", () => {
  const source = read("./blank-download-client.tsx");
  const requests = [...source.matchAll(/challenge\.requireCaptcha\(\)/g)];
  assert.equal(requests.length, 2, "полное окно и короткое окно запомненной почты");
  for (const request of requests) {
    const before = source.slice(Math.max(0, (request.index ?? 0) - 260), request.index);
    assert.match(before, /ymGoal\("blank_download_challenge", (goal|\{ \.\.\.goal, remembered: "1" \})\);\s*$/);
  }
  assert.match(source, /ymGoal\("blank_download_challenge", \{ \.\.\.goal, remembered: "1" \}\)/);
});

test("docs: все цели окна скачивания и как сравнить «до/после» отмены капчи", () => {
  const doc = read("../../../docs/blank-download-analytics.md");
  for (const goal of ["blank_download_click", "blank_download_done", "blank_download_challenge", "blank_quick_register_done"]) {
    assert.ok(doc.includes(goal), goal);
  }
  assert.match(doc, /20\.11\.2026/);
});

test("подсказка поля компании короткая во всех языках: не обрезается на 360 px", async () => {
  // Поле на 360 px вмещает 244 px текста; 28 знаков Geist 16 px — ≈ 240 px
  // (замер на проде 21.11.2026: «Компания или ИП (для шапки)» — 238 px).
  for (const locale of ["ru", "en", "uz"] as const) {
    const placeholder = (await loadMessages(locale)).publicBlankDownload.company.placeholder;
    assert.ok(placeholder.length <= 28, `${locale}: «${placeholder}» — ${placeholder.length} знаков`);
  }
  assert.equal((await loadMessages("ru")).publicBlankDownload.company.placeholder, "Компания или ИП (для шапки)");
});
