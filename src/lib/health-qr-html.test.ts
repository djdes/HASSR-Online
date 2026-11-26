import assert from "node:assert/strict";
import test from "node:test";

import { renderHealthDay, renderHealthForm, renderHealthSuspended } from "./health-qr-html";
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

test("допуск без ответа о здоровье: «Допущен» недоступен с причиной, «Отстранён» доступен", () => {
  const declared = { status: "healthy", confirmations: { temperature: true, infection: true, respiratorySkin: true }, confirmedAt: "06:50", source: "qr" };
  const html = renderHealthDay({
    action: "/x",
    who: "",
    tabs: "",
    rows: [
      { id: "a", name: "Иванова", position: null, mark: { state: "admitted", at: "06:50" }, hygiene: hygieneV2View(declared), answered: true },
      { id: "b", name: "Петрова", position: null, mark: { state: "missing" }, hygiene: hygieneV2View(null), answered: false },
    ],
  });
  assert.match(html, /name="st:a" value="admitted">/);
  assert.match(html, /name="st:b" value="admitted" disabled/);
  assert.doesNotMatch(html, /name="st:b" value="suspended" disabled/);
  assert.match(html, /Допуск недоступен: сотрудник ещё не ответил на вопросы о здоровье/);
  assert.equal((html.match(/data-admit-locked/g) ?? []).length, 1);
});

test("не отметившиеся — ярко-красные (пожелание РПН), ответившие и отсутствующие — нет", () => {
  const declared = { status: "healthy", confirmations: { temperature: true, infection: true, respiratorySkin: true }, confirmedAt: "06:50", source: "qr" };
  const html = renderHealthDay({
    action: "/x",
    who: "",
    tabs: "",
    rows: [
      { id: "a", name: "Иванова", position: null, mark: { state: "admitted", at: "06:50" }, hygiene: hygieneV2View(declared), answered: true },
      { id: "b", name: "Петрова", position: null, mark: { state: "missing" }, hygiene: hygieneV2View(null), answered: false },
      { id: "c", name: "Сидорова", position: null, mark: { state: "missing" }, hygiene: hygieneV2View(null), answered: false },
    ],
  });
  assert.equal((html.match(/class="hq-row hq-miss"/g) ?? []).length, 2);
  assert.equal((html.match(/hq-snone">⚠ Не отметился/g) ?? []).length, 2);
  assert.match(html, /background:#fee2e2;color:#b91c1c">не отметились 2/);
  // Ответившая Иванова — обычная карточка.
  assert.match(html, /<div class="hq-row"><div><div class="hq-n">Иванова/);
});

test("не допущен: с жалобами — причина и «ждите решения», без жалоб — решение ответственного", () => {
  const byComplaint = renderHealthSuspended({ who: "", complaints: ["температура выше 37"], timeLabel: "08:10", backHref: "/x" });
  assert.match(byComplaint, /Причина: температура выше 37./);
  assert.match(byComplaint, /дождитесь его решения/);
  // Ответственный отстранил, сотрудник снова подписал всё (2026-11-26): пустой причины и «уже получил уведомление» нет.
  const byKeeper = renderHealthSuspended({ who: "", complaints: [], timeLabel: "17:00", backHref: "/x" });
  assert.doesNotMatch(byKeeper, /Причина: ./);
  assert.doesNotMatch(byKeeper, /дождитесь его решения/);
  assert.match(byKeeper, /Ответственный отстранил вас от работы на сегодня/);
});
