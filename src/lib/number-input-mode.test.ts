import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { numberInputMode } from "@/lib/number-input-mode";

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("Цифровая клавиатура для чисел", () => {
  it("минус возможен (нет min или min < 0) — не трогаем: у цифровых клавиатур iPhone нет минуса", () => {
    assert.equal(numberInputMode({}), undefined);
    assert.equal(numberInputMode({ min: -30 }), undefined);
    assert.equal(numberInputMode({ min: "-1", step: 1 }), undefined);
    assert.equal(numberInputMode({ min: "abc" }), undefined);
  });

  it("неотрицательное: целый шаг — только цифры, иначе — с разделителем", () => {
    assert.equal(numberInputMode({ min: 0, step: 1 }), "numeric");
    assert.equal(numberInputMode({ min: "1", step: "50" }), "numeric");
    assert.equal(numberInputMode({ min: 0 }), "decimal");
    assert.equal(numberInputMode({ min: 0, step: "0.1" }), "decimal");
    assert.equal(numberInputMode({ min: 0, step: "any" }), "decimal");
    assert.equal(numberInputMode({ min: 0.5, step: 1 }), "decimal");
  });

  it("<Input type=number> ставит inputMode сам", () => {
    const input = readFileSync(path.join(process.cwd(), "src/components/ui/input.tsx"), "utf8");
    assert.match(input, /inputMode=\{inputMode \?\? \(type === "number" \? numberInputMode\(\{ min: props\.min, step: props\.step \}\) : undefined\)\}/);
  });

  it("у каждого самодельного <input type=number> с min есть inputMode", () => {
    const missing: string[] = [];
    for (const file of tsxFiles(path.join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/type="number"/g)) {
        const at = match.index ?? 0;
        const start = Math.max(source.lastIndexOf("<input", at), source.lastIndexOf("<Input", at));
        if (start < 0 || source.startsWith("<Input", start)) continue;
        const end = source.indexOf("/>", at);
        const tag = source.slice(start, end);
        // Без min минус допустим — клавиатуру не меняем (см. numberInputMode).
        if (!/\bmin=/.test(tag)) continue;
        if (!/\binputMode=/.test(tag)) {
          missing.push(`${path.relative(process.cwd(), file)}:${source.slice(0, at).split("\n").length}`);
        }
      }
    }
    assert.deepEqual(missing, []);
  });
});
