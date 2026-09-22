import assert from "node:assert/strict";
import test from "node:test";

import { renderHealthDay, renderHealthForm } from "./health-qr-html";
import { hygieneV2View } from "./hygiene-v2";

test("форма сотрудника: предупреждение, три графы не отмечены, «Подписать»", () => {
  const html = renderHealthForm({ action: "/x", who: "", tabs: "", alreadyAt: null, alreadyAdmitted: null, writesHealth: false });
  assert.match(html, /заведомо ложные сведения/);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /type="checkbox"[^>]*checked/);
  assert.match(html, />Подписать<\/button>/);
});

test("допуск: без решения ничего не выбрано, с решением — выбрано и подписано", () => {
  const declared = { status: "healthy", confirmations: { temperature: true, infection: true, respiratorySkin: true }, confirmedAt: "06:50", source: "qr" };
  const verified = {
    ...declared,
    verification: { result: "suspended", byUserId: "z", byName: "Репешко А.", byTitle: null, at: "07:05", method: "qr" },
  };
  const html = renderHealthDay({
    action: "/x",
    who: "",
    tabs: "",
    rows: [
      { id: "a", name: "Иванова", position: "Повар", mark: { state: "admitted", at: "06:50" }, hygiene: hygieneV2View(declared) },
      { id: "b", name: "Петрова", position: null, mark: { state: "suspended", at: "06:50" }, hygiene: hygieneV2View(verified) },
    ],
  });
  assert.doesNotMatch(html, /name="st:a" value="(admitted|suspended)" checked/);
  assert.match(html, /name="st:b" value="suspended" checked/);
  assert.match(html, /ждёт допуска/);
  assert.match(html, /отстранён · Репешко А\. · 07:05/);
  assert.match(html, /name="ab:a"/);
  // Ждущий допуска — сверху.
  assert.ok(html.indexOf("Иванова") < html.indexOf("Петрова"));
});
