import test from "node:test";
import assert from "node:assert/strict";

import { addMonths, approvalOf, latestDocVersion, meetingNumber, nextMeetingDate, shortName, sortedVersions } from "./review";
import type { DocVersion, TeamMeeting } from "./records";

const v = (doc: DocVersion["doc"], version: number, approvedAt: string): DocVersion => ({
  doc,
  version,
  approvedAt,
  approvedById: null,
  note: "",
});
const m = (date: string): TeamMeeting => ({ date, topic: "Тема", decisions: "", attendeeIds: [] });

test("addMonths: прибавляет месяцы, обрезает день до конца месяца, переходит через год", () => {
  assert.equal(addMonths("2026-10-17", 3), "2027-01-17");
  assert.equal(addMonths("2026-11-30", 3), "2027-02-28");
  assert.equal(addMonths("2023-11-30", 3), "2024-02-29");
  assert.equal(addMonths("2026-10-17", 12), "2027-10-17");
  assert.equal(addMonths("2024-02-29", 12), "2025-02-28");
});

test("latestDocVersion: самая большая версия нужного документа, иначе null", () => {
  const all = [v("ppk", 1, "2025-01-01"), v("ppk", 3, "2026-10-12"), v("haccp-plan", 7, "2026-01-01"), v("ppk", 2, "2025-06-01")];
  assert.equal(latestDocVersion(all, "ppk")?.version, 3);
  assert.equal(latestDocVersion(all, "haccp-plan")?.version, 7);
  assert.equal(latestDocVersion([], "ppk"), null);
});

test("sortedVersions: новые сверху, только свой документ", () => {
  const all = [v("ppk", 1, "2025-01-01"), v("haccp-plan", 9, "2026-01-01"), v("ppk", 2, "2025-06-01")];
  assert.deepEqual(sortedVersions(all, "ppk").map((x) => x.version), [2, 1]);
});

test("nextMeetingDate: последнее заседание + 3 месяца; без заседаний — null", () => {
  assert.equal(nextMeetingDate([m("2026-04-10"), m("2026-07-15")]), "2026-10-15");
  assert.equal(nextMeetingDate([]), null);
});

test("meetingNumber: порядковый номер по дате, при равных датах — по порядку в списке", () => {
  const list = [m("2026-07-15"), m("2026-04-10"), m("2026-10-01")];
  assert.equal(meetingNumber(list, list[1]), 1);
  assert.equal(meetingNumber(list, list[0]), 2);
  assert.equal(meetingNumber(list, list[2]), 3);
});

test("shortName: фамилия и первая буква имени", () => {
  assert.equal(shortName("Иванова Анна Петровна"), "Иванова А.");
  assert.equal(shortName("  петров   иван "), "петров И.");
  assert.equal(shortName("Администратор"), "Администратор");
  assert.equal(shortName(""), "");
});

test("approvalOf: последняя версия и утвердивший; без версии — null; уволенный — без утвердившего", () => {
  const staff = [{ id: "u1", name: "Иванова Анна", title: "Директор" }];
  const list = [{ ...v("ppk", 1, "2025-01-01"), approvedById: "u2" }, { ...v("ppk", 2, "2026-10-12"), approvedById: "u1" }];
  assert.deepEqual(approvalOf(list, "ppk", staff), { version: 2, approvedAt: "2026-10-12", approver: { name: "Иванова Анна", title: "Директор" } });
  assert.equal(approvalOf(list, "haccp-plan", staff), null);
  assert.equal(approvalOf([list[0]], "ppk", staff)?.approver, null);
});
