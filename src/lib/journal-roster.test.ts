import assert from "node:assert/strict";
import test from "node:test";

import {
  filterRoster,
  isPlaceholderStaffUser,
  leadershipTier,
  pickRosterForUnsetSlot,
  rankRosterForSlot,
  resolveResponsibleChoice,
  type RosterUser,
} from "@/lib/journal-roster";

const owner: RosterUser = { id: "owner", name: "boss@mail.ru", email: "boss@mail.ru", role: "owner" };
const root: RosterUser = { id: "root", name: "Администратор", role: "manager", isRoot: true };
const manager: RosterUser = { id: "mgr", name: "Анна Заведующая", role: "manager", jobPositionName: "Заведующая производством", jobPositionCategory: "management" };
const cook: RosterUser = { id: "cook", name: "Борис Повар", role: "cook", jobPositionName: "Повар", jobPositionCategory: "staff" };
const cleaner: RosterUser = { id: "cleaner", name: "Вера Уборщица", role: "cook", positionTitle: "Уборщица" };

test("заглушки: имя = почта, пустое имя, «Иванов И.И.»", () => {
  assert.equal(isPlaceholderStaffUser(owner), true);
  assert.equal(isPlaceholderStaffUser({ name: "  " }), true);
  assert.equal(isPlaceholderStaffUser({ name: "Иванов И.И." }), true);
  assert.equal(isPlaceholderStaffUser({ name: "x@y.ru" }), true);
  assert.equal(isPlaceholderStaffUser(cook), false);
});

test("filterRoster убирает ROOT всегда, заглушки — если есть другие", () => {
  assert.deepEqual(filterRoster([owner, root, cook]).map((u) => u.id), ["cook"]);
  assert.deepEqual(filterRoster([owner, root]).map((u) => u.id), ["owner"]);
  assert.deepEqual(filterRoster([root]), []);
});

test("исполнитель: должность → линейный персонал → руководство, не владелец и не ROOT", () => {
  const users = [owner, root, manager, cook, cleaner];
  assert.equal(rankRosterForSlot(users, { kind: "filler", positionKeywords: ["уборщ"] })?.id, "cleaner");
  assert.equal(rankRosterForSlot(users, { kind: "filler" })?.id, "cook");
  assert.equal(rankRosterForSlot([owner, root, manager], { kind: "filler" })?.id, "mgr");
  assert.equal(rankRosterForSlot(users, { kind: "filler" }, new Set(["cook", "cleaner"]))?.id, "mgr");
});

test("проверяющий: руководство раньше персонала, повтор разрешён", () => {
  const users = [owner, root, cook, manager];
  assert.equal(rankRosterForSlot(users, { kind: "verifier" })?.id, "mgr");
  assert.equal(rankRosterForSlot(users, { kind: "verifier" }, new Set(["mgr", "cook"]))?.id, "mgr");
});

test("пустой ростер или только ROOT → null", () => {
  assert.equal(rankRosterForSlot([], { kind: "filler" }), null);
  assert.equal(rankRosterForSlot([root], { kind: "verifier" }), null);
  assert.equal(rankRosterForSlot([cook], { kind: "filler" }, new Set(["cook"])), null);
});

test("resolveResponsibleChoice: источник × валидность", () => {
  const org = new Set(["cook", "mgr"]);
  assert.deepEqual(resolveResponsibleChoice({ bodyUserId: "cook", slotUserId: "mgr", orgUserIds: org }), { userId: "cook", source: "body" });
  assert.deepEqual(resolveResponsibleChoice({ bodyUserId: "", slotUserId: "mgr", orgUserIds: org }), { userId: "mgr", source: "slots" });
  assert.deepEqual(resolveResponsibleChoice({ bodyUserId: null, slotUserId: "foreign", orgUserIds: org }), { userId: null, source: "none" });
  assert.deepEqual(resolveResponsibleChoice({ bodyUserId: undefined, orgUserIds: org }), { userId: null, source: "none" });
  const bad = resolveResponsibleChoice({ bodyUserId: "foreign", slotUserId: "mgr", orgUserIds: org });
  assert.ok("error" in bad);
  assert.equal(bad.error.code, "responsible-not-in-org");
});

// Тикет 57187T: автоподбор не ставит «первого по алфавиту».
const abd: RosterUser = { id: "abd", name: "Абдулкадирова Индира", role: "cook", jobPositionName: "Кухонный рабочий", jobPositionCategory: "staff" };
const senior: RosterUser = { id: "senior", name: "Яна Старшая", role: "cook", jobPositionName: "Старший повар", jobPositionCategory: "staff" };
const foreman: RosterUser = { id: "foreman", name: "Борис Бригадир", role: "cook", positionTitle: "Бригадир" };
const chef: RosterUser = { id: "chef", name: "Юрий Шеф", role: "cook", jobPositionName: "Шеф-повар", jobPositionCategory: "staff" };

test("leadershipTier: шеф и заведующий — 1, старший и бригадир — 2, рядовой — null", () => {
  assert.equal(leadershipTier(chef), 1);
  assert.equal(leadershipTier(manager), 1);
  assert.equal(leadershipTier({ id: "o", name: "Олег", role: "owner" }), 1);
  assert.equal(leadershipTier(senior), 2);
  assert.equal(leadershipTier(foreman), 2);
  assert.equal(leadershipTier(abd), null);
  assert.equal(leadershipTier(cook), null);
});

test("главный слот: только руководящая должность, рядовой по алфавиту не встаёт", () => {
  const slot = { kind: "filler" as const, positionKeywords: ["шеф", "повар"], leader: true };
  assert.equal(pickRosterForUnsetSlot([abd, cook, cleaner], slot), null);
  assert.equal(pickRosterForUnsetSlot([abd, cook, senior], slot)?.id, "senior");
  // Шеф и заведующий раньше старшего, даже если тот первый в списке.
  assert.equal(pickRosterForUnsetSlot([abd, senior, foreman, chef], slot)?.id, "chef");
  // В одной ступени — тот, чья должность подходит слоту.
  assert.equal(pickRosterForUnsetSlot([manager, chef], slot)?.id, "chef");
  assert.equal(pickRosterForUnsetSlot([manager, chef], { ...slot, positionKeywords: ["уборщ"] })?.id, "mgr");
  // ROOT и аккаунт «имя = почта» — не раньше людей.
  assert.equal(pickRosterForUnsetSlot([root, owner, abd], slot), null);
  assert.equal(pickRosterForUnsetSlot([root, owner], slot)?.id, "owner");
});

test("главный слот: занятого исполнителя не дублируем, проверяющий может совпадать", () => {
  const used = new Set(["chef"]);
  assert.equal(pickRosterForUnsetSlot([chef, senior], { kind: "filler", leader: true }, used)?.id, "senior");
  assert.equal(pickRosterForUnsetSlot([chef], { kind: "filler", leader: true }, used), null);
  assert.equal(pickRosterForUnsetSlot([abd, chef], { kind: "verifier", leader: true }, used)?.id, "chef");
});

test("прочие слоты исполнителей: только должность слота, иначе никто", () => {
  const slot = { kind: "filler" as const, positionKeywords: ["уборщ", "клинер"], leader: false };
  assert.equal(pickRosterForUnsetSlot([abd, cook, cleaner], slot)?.id, "cleaner");
  assert.equal(pickRosterForUnsetSlot([abd, cook, manager], slot), null);
  assert.equal(pickRosterForUnsetSlot([cleaner], slot, new Set(["cleaner"])), null);
  assert.equal(pickRosterForUnsetSlot([abd, cook], { kind: "filler", leader: false }), null);
});

test("порядок списка значим: свои люди точки идут первыми и побеждают в ступени", () => {
  const everywhereChief: RosterUser = { id: "a-chief", name: "Абрамова Заведующая", role: "cook", jobPositionName: "Заведующая производством" };
  const pointChief: RosterUser = { id: "p-chief", name: "Яковлева Заведующая", role: "cook", jobPositionName: "Заведующая производством" };
  assert.equal(pickRosterForUnsetSlot([pointChief, everywhereChief], { kind: "filler", leader: true })?.id, "p-chief");
});
