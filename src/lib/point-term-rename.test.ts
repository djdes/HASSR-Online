import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * «Торговая точка» → «объект» (спека trial-emails-rename-2026-11): старого
 * термина нет в словарях, договорах и коде; en без «outlet», uz без «savdo nuqta».
 */

test("AC5: в русском словаре, договорах и коде нет «торговой точки»", () => {
  const ru = readFileSync("src/i18n/messages/ru.json", "utf8");
  assert.doesNotMatch(ru, /торгов(?:ая|ой|ую|ые|ых|ым|ыми)\s+точ/i);
  for (const file of ["src/lib/contracts/template.ts", "src/lib/contracts/sections-2026-10-29.ts"]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /торгов\S*\s+точ/i, file);
    assert.match(readFileSync(file, "utf8"), /объект/, `${file}: термин «объект»`);
  }
  const skip = new Set(["src/i18n/message-contract.d.ts", "src/lib/point-term-rename.test.ts"]);
  const hits = (readdirSync("src", { recursive: true }) as string[])
    .map((file) => join("src", file))
    .filter((file) => /\.(ts|tsx|json)$/.test(file) && !skip.has(file.replaceAll("\\", "/")) && statSync(file).isFile())
    .filter((file) => /торгов(?:ая|ой|ую|ые|ых|ым|ыми)\s+точ/i.test(readFileSync(file, "utf8")));
  assert.deepEqual(hits, []);
});

test("AC5: английский и узбекский — без «outlet» и «savdo nuqta»", () => {
  assert.doesNotMatch(readFileSync("src/i18n/messages/en.json", "utf8"), /\boutlets?\b/i);
  assert.doesNotMatch(readFileSync("src/i18n/messages/uz.json", "utf8"), /savdo\s+nuqta/i);
});

test("AC5: согласование — нет «объект» с прилагательным женского рода", () => {
  const ru = readFileSync("src/i18n/messages/ru.json", "utf8");
  assert.doesNotMatch(ru, /(?:новая|каждая|одна|эта|выбранная|основная|текущая|ваша)\s+объект\b/i);
  assert.doesNotMatch(ru, /(?:каждую|эту|новую|одну|выбранную)\s+объект\b/i);
  assert.doesNotMatch(ru, /(?:каждой|этой|одной|выбранной|основной)\s+объект(?:а|у|е|ом)\b/i);
});
