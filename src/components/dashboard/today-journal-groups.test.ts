import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { splitTodayJournals } from "@/components/dashboard/dashboard-journals-layout";

const item = (name: string, filled: boolean) => ({ name, filled });

describe("«Сегодня»: сначала то, что осталось", () => {
  it("часть заполнена — незаполненные сверху, заполненные ниже, порядок внутри групп сохранён", () => {
    const items = [item("Акт", true), item("Бракераж", false), item("Гигиена", true), item("Уборка", false)];
    const { todo, done } = splitTodayJournals(items, { searching: false });
    assert.deepEqual(todo.map((i) => i.name), ["Бракераж", "Уборка"]);
    assert.deepEqual(done.map((i) => i.name), ["Акт", "Гигиена"]);
  });

  it("всё заполнено или ничего — один список, как раньше", () => {
    const none = [item("Акт", false), item("Бракераж", false)];
    assert.deepEqual(splitTodayJournals(none, { searching: false }), { todo: none, done: [] });
    const all = [item("Акт", true), item("Бракераж", true)];
    assert.deepEqual(splitTodayJournals(all, { searching: false }), { todo: all, done: [] });
  });

  it("при поиске — один список: важнее найти", () => {
    const items = [item("Акт", true), item("Бракераж", false)];
    assert.deepEqual(splitTodayJournals(items, { searching: true }), { todo: items, done: [] });
  });
});

describe("Панель над списком журналов", () => {
  it("поиск и кнопки одной строкой, если помещаются (телефон — поиск и «QR-коды»)", async () => {
    const { JOURNAL_TOOLBAR_CLASS } = await import("@/components/dashboard/dashboard-journals-layout");
    assert.match(JOURNAL_TOOLBAR_CLASS, /flex-wrap/);
    assert.match(JOURNAL_TOOLBAR_CLASS, /lg:flex-nowrap/);
    assert.doesNotMatch(JOURNAL_TOOLBAR_CLASS, /flex-col/);
  });
});
