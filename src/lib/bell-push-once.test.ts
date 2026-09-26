import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Одно событие — один push. Уведомление в колокольчике (`upsertNotification`)
 * само шлёт push в приложение; если то же событие тому же человеку ещё и
 * пишет личное сообщение бота (`notifyEmployee`), второй push выключается
 * опцией `appPush: false`. Раньше это делало 20-секундное окно в памяти
 * по userId, которое заодно глушило push про другие события.
 */
const SITES = ["src/lib/qr-pin-requests.ts", "src/lib/core-journal-keepers.ts"];

for (const file of SITES) {
  test(`${file}: сообщение бота рядом с колокольчиком — без второго push`, () => {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    assert.match(source, /upsertNotification\(/);
    // Первый вызов notifyEmployee после колокольчика.
    const bell = source.indexOf("upsertNotification(");
    const call = source.indexOf("notifyEmployee(", bell);
    assert.ok(call > bell, "notifyEmployee после upsertNotification");
    // Аргументы вызова — до конца выражения.
    const args = source.slice(call, source.indexOf(";", call));
    assert.match(args, /appPush:\s*false/);
  });
}

/**
 * То же для рассылки руководителям: `notifyOrganization` рядом с
 * `notifyManagement` про одно событие. Колокольчик уже шлёт push —
 * рассылке бота второй push не нужен.
 */
const ORG_SITES = ["src/lib/journal-fill-submit.ts", "src/lib/partners/service.ts", "src/lib/support-threads.ts"];

function callArgs(source: string, start: number): string {
  let depth = 0;
  for (let i = source.indexOf("(", start); i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

for (const file of ORG_SITES) {
  test(`${file}: рассылка руководителям рядом с колокольчиком — без второго push`, () => {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    const bells = [...source.matchAll(/notifyManagement\(/g)].map((m) => m.index ?? 0);
    const orgCalls = [...source.matchAll(/notifyOrganization\(/g)]
      .map((m) => m.index ?? 0)
      .filter((at) => source.slice(0, at).trimEnd().endsWith("function") === false)
      .filter((at) => bells.some((bell) => Math.abs(bell - at) < 1500));
    assert.ok(orgCalls.length > 0, "есть рассылка рядом с колокольчиком");
    for (const at of orgCalls) {
      assert.match(callArgs(source, at), /appPush:\s*false/);
    }
  });
}
