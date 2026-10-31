import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { composeLowNpsAlert, composeProfileCompletedAlert, isLowNpsScore } from "@/lib/lead-alerts";

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("горячие лиды — админу в Telegram", () => {
  it("низкая оценка: 1–3 из 5, 0–6 из 10", () => {
    assert.deepEqual([1, 2, 3, 4, 5].map((s) => isLowNpsScore(s, 5)), [true, true, true, false, false]);
    assert.equal(isLowNpsScore(0, 10), true);
    assert.equal(isLowNpsScore(6, 10), true);
    assert.equal(isLowNpsScore(7, 10), false);
  });

  it("анкета: организация, сфера, точки, имя, телефон и почта, всё экранировано", () => {
    const text = composeProfileCompletedAlert({
      organizationName: "Кафе <Ромашка> & Ко",
      sphereLabel: "Кафе / Кофейня",
      locationsCount: 3,
      name: "Анна",
      phone: "+79991234567",
      email: "anna@example.ru",
      escape,
    });
    assert.equal(
      text,
      [
        "📋 Анкета заполнена — можно звонить",
        "Организация: Кафе &lt;Ромашка&gt; &amp; Ко",
        "Сфера: Кафе / Кофейня, точек: 3",
        "Контакт: Анна, +79991234567",
        "Почта: anna@example.ru",
      ].join("\n"),
    );
    assert.match(composeProfileCompletedAlert({ organizationName: "Цех", sphereLabel: "Производство", locationsCount: 0, name: "И", phone: "+7", email: "e@x.ru", escape }), /точек: 1/);
  });

  it("низкая оценка: шкала, комментарий или подсказка позвонить; дописанный комментарий — отдельным заголовком", () => {
    const first = composeLowNpsAlert({ organizationName: "Цех", userName: "Иван", score: 2, scale: 5, comment: null, escape });
    assert.match(first, /^⚠️ Низкая оценка WeSetup/);
    assert.match(first, /Оценка: 2 из 5/);
    assert.match(first, /Комментария нет — стоит позвонить/);
    const later = composeLowNpsAlert({ organizationName: "Цех", userName: "Иван", score: 5, scale: 10, comment: "Долго <грузится>", followUp: true, escape });
    assert.match(later, /^💬 Комментарий к низкой оценке/);
    assert.match(later, /Оценка: 5 из 10/);
    assert.match(later, /Комментарий: Долго &lt;грузится&gt;/);
  });

  it("маршруты шлют сообщения без ожидания и с ключом от повторов", () => {
    const profile = read("src/app/api/profile/complete/route.ts");
    assert.match(profile, /dedupeKey: `profile_completed:\$\{organizationId\}`/);
    assert.match(profile, /\.catch\(\(error\) => console\.error\("\[profile\/complete\] admin alert failed"/);
    const nps = read("src/app/api/nps/route.ts");
    assert.match(nps, /dedupeKey: `nps:\$\{response\.id\}`/);
    assert.match(nps, /becameLow \? `nps:\$\{existing\.id\}` : `nps-comment:\$\{existing\.id\}`/);
    assert.match(nps, /\.catch\(\(error\) => console\.error\("\[nps\] admin alert failed"/);
  });
});
