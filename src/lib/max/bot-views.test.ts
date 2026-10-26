import assert from "node:assert/strict";
import { test } from "node:test";
import type { MaxView } from "./client";
import {
  helpView,
  inviteForwardText,
  inviteListView,
  journalsView,
  menuView,
  parseBotPayload,
  remindConfirmView,
  reminderMessage,
  summaryView,
  todayView,
  unlinkedView,
} from "./bot-views";
import { MAX_BOT_STATE_TTL_MS, newWizardId, parseMaxBotState, parseWizardPayload, wizardPayload } from "./bot-state";
import { maxInviteUrl, newMaxInviteToken, parseMaxInvitePayload } from "./invite";
import { maxMessageBody } from "./client";

const callbacks = (view: MaxView) => view.buttons.flat().map((button) => (button.type === "callback" ? button.payload : `link:${button.url}`));
const texts = (view: MaxView) => view.buttons.flat().map((button) => button.text);

test("bot payloads: commands, legacy buttons and strict ids", () => {
  assert.deepEqual(parseBotPayload("/start"), { kind: "menu" });
  assert.deepEqual(parseBotPayload("Меню"), { kind: "menu" });
  assert.deepEqual(parseBotPayload("/tasks"), { kind: "today" });
  assert.deepEqual(parseBotPayload("/journals"), { kind: "journals", page: 0 });
  assert.deepEqual(parseBotPayload("journals:2"), { kind: "journals", page: 2 });
  assert.deepEqual(parseBotPayload("jr:1"), { kind: "journals", page: 1 });
  assert.deepEqual(parseBotPayload("orgs:0"), { kind: "orgs", page: 0 });
  assert.deepEqual(parseBotPayload("go:hygiene"), { kind: "fill", code: "hygiene", documentId: null });
  assert.deepEqual(parseBotPayload("go:finished_product:cmabc123"), { kind: "fill", code: "finished_product", documentId: "cmabc123" });
  assert.deepEqual(parseBotPayload("obj:cold_equipment_control"), { kind: "object", code: "cold_equipment_control" });
  assert.deepEqual(parseBotPayload("invu:u_1"), { kind: "invite", userId: "u_1" });
  assert.deepEqual(parseBotPayload("remok"), { kind: "remindConfirm" });
  for (const junk of ["go:../x", "go:Hygiene", "org:", "jr:-1", "привет", "inv:abc", ""]) assert.equal(parseBotPayload(junk), null, junk);
});

test("wizard payloads round-trip and reject junk", () => {
  const payload = wizardPayload({ id: "a1b2c3", seq: 7 }, "p", 3);
  assert.equal(payload, "w:a1b2c3.7:p:3");
  assert.deepEqual(parseWizardPayload(payload), { id: "a1b2c3", seq: 7, action: "p", arg: "3" });
  assert.deepEqual(parseWizardPayload("w:a1b2c3.7:save"), { id: "a1b2c3", seq: 7, action: "save", arg: null });
  for (const junk of ["w:A1.7:p", "w:a1.x:p", "w:a1.7:", "x:a1.7:p", "w:a1.7:p:3:4"]) assert.equal(parseWizardPayload(junk), null, junk);
  assert.match(newWizardId(), /^[a-z0-9]{6}$/);
});

test("dialog state expires after two hours and invalid JSON is ignored", () => {
  const raw = {
    kind: "fill", id: "abc123", seq: 1, orgId: "o", code: "hygiene", name: "Гигиена", phase: "field",
    documentId: "d", documentTitle: null, rowKey: "employee-u", rowLabel: null, choices: [], step: 0, keys: [],
    values: { a: 1 }, off: [], correction: null, picks: [], editing: false, notice: null,
  };
  const now = new Date("2026-10-26T12:00:00Z");
  assert.equal(parseMaxBotState(raw, new Date(now.getTime() - 60_000), now)?.code, "hygiene");
  assert.equal(parseMaxBotState(raw, new Date(now.getTime() - MAX_BOT_STATE_TTL_MS - 1), now), null);
  assert.equal(parseMaxBotState(raw, null, now), null);
  assert.equal(parseMaxBotState({ ...raw, phase: "hack" }, now, now), null);
  assert.equal(parseMaxBotState({ ...raw, values: { a: { nested: true } } }, now, now), null);
});

test("employee menu: progress, one-tap next journal, tasks and all journals", () => {
  const view = menuView({
    userName: "Анна Петрова", organizationName: "Кафе «Ромашка»", dateLabel: "26.10.2026", canFill: true,
    tasks: [
      { code: "cold_equipment_control", name: "Холодильники", done: false, object: true },
      { code: "hygiene", name: "Гигиенический журнал", done: false, object: false },
      { code: "health_check", name: "Журнал здоровья", done: true, object: false },
    ],
    manager: false, multipleOrganizations: false,
  });
  assert.match(view.text, /Сегодня заполнено 1 из 3/);
  assert.match(view.text, /Осталось: Холодильники, Гигиенический журнал/);
  assert.deepEqual(callbacks(view), ["go:hygiene", "today", "jr:0", "help"]);
  assert.equal(texts(view)[0], "✍️ Заполнить: Гигиенический журнал");
});

test("manager menu adds summary, reminders and staff connection; no fill without access", () => {
  const view = menuView({
    userName: "Олег", organizationName: "Кафе", dateLabel: "26.10.2026", canFill: false,
    fillNote: "Заполнять журналы из бота можно в своей организации.", tasks: [], manager: true, multipleOrganizations: true,
  });
  assert.match(view.text, /в своей организации/);
  assert.deepEqual(callbacks(view), ["sum", "rem", "inv:0", "help", "orgs:0"]);
});

test("all done and no tasks have their own copy", () => {
  const done = menuView({ userName: "А", organizationName: "К", dateLabel: "d", canFill: true, tasks: [{ code: "hygiene", name: "Г", done: true, object: false }], manager: false, multipleOrganizations: false });
  assert.match(done.text, /всё заполнено ✅/);
  assert.ok(!callbacks(done).some((payload) => payload.startsWith("go:")));
  const empty = todayView({ dateLabel: "26.10.2026", tasks: [] });
  assert.match(empty.text, /задач нет/);
});

test("today list: pending first, object journals point to the sticker hint", () => {
  const view = todayView({
    dateLabel: "26.10.2026",
    tasks: [
      { code: "health_check", name: "Здоровье", done: true, object: false },
      { code: "cold_equipment_control", name: "Холодильники", done: false, object: true },
      { code: "hygiene", name: "Гигиена", done: false, object: false },
    ],
  });
  assert.match(view.text, /⏳ Гигиена/);
  assert.match(view.text, /🏷 Холодильники — по наклейке/);
  assert.match(view.text, /✅ Здоровье/);
  assert.deepEqual(callbacks(view), ["obj:cold_equipment_control", "go:hygiene", "jr:0", "menu"]);
});

test("journals list pages by eight with navigation", () => {
  const journals = Array.from({ length: 11 }, (_, index) => ({ code: `j${index}`, name: `Журнал ${index}`, object: index === 10 }));
  const first = journalsView({ organizationName: "Кафе", journals, page: 0 });
  assert.equal(callbacks(first).filter((payload) => payload.startsWith("go:")).length, 8);
  assert.ok(callbacks(first).includes("jr:1"));
  const second = journalsView({ organizationName: "Кафе", journals, page: 5 });
  assert.match(second.text, /Страница 2 из 2/);
  assert.ok(callbacks(second).includes("obj:j10"));
  assert.ok(callbacks(second).includes("jr:0"));
});

test("summary shows who has not filled and offers reminders only for MAX users", () => {
  const view = summaryView({
    organizationName: "Кафе", dateLabel: "26.10.2026", total: 6, done: 4,
    rows: [
      { name: "Иванов Иван", journals: ["Гигиена", "Бракераж", "Уборка"], inMax: true },
      { name: "Петров Пётр", journals: ["Гигиена"], inMax: false },
    ],
  });
  assert.match(view.text, /Заполнено 4 из 6 \(67%\)/);
  assert.match(view.text, /Иванов Иван — Гигиена, Бракераж и ещё 1/);
  assert.match(view.text, /Петров Пётр — Гигиена \(нет в MAX\)/);
  assert.deepEqual(callbacks(view), ["rem", "inv:0", "sum", "menu"]);
  assert.equal(texts(view)[0], "🔔 Напомнить (1 в MAX)");
  // Сам руководитель в сводке есть, но в число адресатов напоминания не входит.
  const self = summaryView({ organizationName: "К", dateLabel: "d", total: 2, done: 0, rows: [{ name: "Олег", journals: ["Гигиена"], inMax: true, self: true }] });
  assert.match(self.text, /Олег — Гигиена/);
  assert.ok(!callbacks(self).includes("rem"));
});

test("reminder confirmation, throttle and empty cases", () => {
  assert.deepEqual(callbacks(remindConfirmView({ reachable: 3, notInMax: 1, waitMinutes: null })), ["remok", "menu"]);
  assert.match(remindConfirmView({ reachable: 3, notInMax: 0, waitMinutes: 12 }).text, /через 12 мин/);
  assert.match(remindConfirmView({ reachable: 0, notInMax: 2, waitMinutes: null }).text, /2 сотрудника с незаполненными журналами ещё не в MAX/);
  assert.match(remindConfirmView({ reachable: 1, notInMax: 5, waitMinutes: null }).text, /напоминание 1 сотруднику в MAX\?[\s\S]*Ещё 5 сотрудников не в MAX/);
  assert.match(remindConfirmView({ reachable: 0, notInMax: 0, waitMinutes: null }).text, /все сотрудники заполнили/);
  const message = reminderMessage({ name: "Анна", journals: [{ code: "cold_equipment_control", name: "Холодильники", object: true }, { code: "hygiene", name: "Гигиена" }] });
  assert.match(message.text, /Холодильники — по наклейке на объекте/);
  assert.deepEqual(callbacks(message), ["go:hygiene", "today"]);
});

test("invites: list without connected staff, forwardable text and strict codes", () => {
  const list = inviteListView({ candidates: [{ id: "u1", name: "Анна", position: "Повар" }], connected: 3, total: 4, page: 0 });
  assert.match(list.text, /Уже в MAX: 3 из 4/);
  assert.deepEqual(callbacks(list), ["invu:u1", "menu"]);
  assert.equal(texts(list)[0], "Анна · Повар");
  const token = newMaxInviteToken();
  assert.match(token, /^inv_[A-Za-z0-9_-]{32}$/);
  assert.equal(parseMaxInvitePayload(token), token);
  assert.equal(parseMaxInvitePayload(`/start ${token}`), token);
  assert.equal(parseMaxInvitePayload("inv_short"), null);
  assert.equal(parseMaxInvitePayload(`${token}x`), null);
  const url = maxInviteUrl("wesetup_bot", token);
  assert.equal(url, `https://max.ru/wesetup_bot?start=${token}`);
  const forward = inviteForwardText({ url, code: token, organizationName: "Кафе" });
  assert.ok(forward.includes(url) && forward.includes(token));
});

test("no mini-site: only the unlinked screen carries a site link", () => {
  const views = [helpView(true), todayView({ dateLabel: "d", tasks: [] }), summaryView({ organizationName: "К", dateLabel: "d", total: 0, done: 0, rows: [] })];
  for (const view of views) assert.ok(callbacks(view).every((payload) => !payload.startsWith("link:")));
  assert.deepEqual(callbacks(unlinkedView("https://wesetup.ru/max/connect")), ["link:https://wesetup.ru/max/connect"]);
});

test("message body respects MAX keyboard limits", () => {
  const view: MaxView = { text: "x".repeat(5000), buttons: Array.from({ length: 40 }, (_, row) => Array.from({ length: 9 }, (_, col) => ({ type: "callback" as const, text: `${row}-${col}`, payload: "menu" }))) };
  const body = maxMessageBody(view);
  assert.equal(body.text.length, 4000);
  const rows = (body.attachments[0] as { payload: { buttons: unknown[][] } }).payload.buttons;
  assert.equal(rows.length, 30);
  assert.ok(rows.every((row) => row.length <= 7));
  assert.deepEqual(maxMessageBody({ text: "a", buttons: [] }).attachments, []);
});
