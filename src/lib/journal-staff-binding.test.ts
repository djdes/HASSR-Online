import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeJournalDocumentStaffState,
  normalizeJournalStaffBoundConfig,
  pickChangedConfigResponsible,
  pickFallbackResponsibleUser,
  reconcileNamedStaffSelection,
  type StaffBindingUser,
} from "@/lib/journal-staff-binding";

/**
 * Ответственный документа больше не подставляется «кем-нибудь»:
 * сохранение ячейки не должно делать владельца ответственным журнала.
 */

const owner: StaffBindingUser = { id: "owner", name: "boss@mail.ru", role: "owner" };
const manager: StaffBindingUser = { id: "mgr", name: "Анна Заведующая", role: "manager" };
const cook: StaffBindingUser = { id: "cook", name: "Борис Повар", role: "cook" };
const roster = [owner, manager, cook];

test("без выбора и без запрета — исполнитель из ростера, не владелец-почта", () => {
  assert.equal(pickFallbackResponsibleUser(roster)?.id, "cook");
  assert.equal(pickFallbackResponsibleUser([owner])?.id, "owner");
  assert.equal(pickFallbackResponsibleUser([]), null);
});

test("allowFallbackUser: false — никто не назначается молча", () => {
  const state = normalizeJournalDocumentStaffState(
    "hygiene",
    { config: {}, responsibleUserId: null },
    roster,
    { allowFallbackUser: false }
  );
  assert.equal(state.responsibleUserId, null);
});

test("явный id сотрудника организации сохраняется", () => {
  const state = normalizeJournalDocumentStaffState(
    "hygiene",
    { config: {}, responsibleUserId: "mgr" },
    roster,
    { allowFallbackUser: false }
  );
  assert.equal(state.responsibleUserId, "mgr");
});

test("чужой id (не из ростера) не превращается во владельца", () => {
  const state = normalizeJournalDocumentStaffState(
    "hygiene",
    { config: {}, responsibleUserId: "foreign-user" },
    roster,
    { allowFallbackUser: false }
  );
  assert.equal(state.responsibleUserId, null);
});

test("ответственный из конфига (defaultResponsibleUserId) подхватывается без подстановок", () => {
  const state = normalizeJournalDocumentStaffState(
    "complaint_register",
    { config: { defaultResponsibleUserId: "cook" }, responsibleUserId: null },
    roster,
    { allowFallbackUser: false }
  );
  assert.equal(state.responsibleUserId, "cook");
});

test("пустое имя в поле бланка остаётся пустым, заглушка заменяется", () => {
  const empty = reconcileNamedStaffSelection(roster, {
    userName: "",
    allowFallbackUser: "placeholder-only",
  });
  assert.equal(empty.userId, null);

  const placeholder = reconcileNamedStaffSelection(roster, {
    userName: "Иванов И.И.",
    allowFallbackUser: "placeholder-only",
  });
  assert.equal(placeholder.userId, "cook");

  const approver = reconcileNamedStaffSelection(roster, {
    userName: "Иванов И.И.",
    allowFallbackUser: "placeholder-only",
    fallbackKind: "verifier",
  });
  assert.equal(approver.userId, "mgr");
});

test("сохранение конфига дезсредств не вписывает ответственного в пустые строки", () => {
  const config = normalizeJournalStaffBoundConfig(
    "disinfectant_usage",
    {
      responsibleEmployee: "",
      receipts: [{ id: "r1", date: "2026-09-01", responsibleEmployee: "" }],
    },
    roster
  ) as {
    responsibleEmployeeId: string | null;
    receipts: Array<{ responsibleEmployeeId: string | null }>;
  };
  assert.equal(config.responsibleEmployeeId, null);
  assert.equal(config.receipts[0]?.responsibleEmployeeId, null);
});

test("сохранение строк с прежним выбором в конфиге ответственного не назначает", () => {
  const config = { defaultResponsibleUserId: "cook", rows: [] };
  assert.equal(
    pickChangedConfigResponsible({
      templateCode: "complaint_register",
      previousConfig: config,
      nextConfig: { ...config, rows: [{ id: "r1" }] },
      users: roster,
    }),
    null
  );
});

test("выбор ответственного в диалоге настроек (внутри конфига) переносится", () => {
  const choice = pickChangedConfigResponsible({
    templateCode: "complaint_register",
    previousConfig: { defaultResponsibleUserId: "cook" },
    nextConfig: { defaultResponsibleUserId: "mgr" },
    users: roster,
  });
  assert.equal(choice?.responsibleUserId, "mgr");
});

test("чужой id в конфиге не становится ответственным", () => {
  assert.equal(
    pickChangedConfigResponsible({
      templateCode: "complaint_register",
      previousConfig: {},
      nextConfig: { defaultResponsibleUserId: "foreign-user" },
      users: roster,
    }),
    null
  );
});

/**
 * Строка, чей человек не нашёлся в ростере (уволен, чужое имя), не должна
 * получать должность ответственного документа — это должность другого
 * человека. Остаётся только то, что сохранено в самой строке.
 */
test("прослеживаемость: ненайденный человек строки не получает должность документа", () => {
  const config = normalizeJournalStaffBoundConfig(
    "traceability_test",
    {
      defaultResponsibleEmployeeId: "mgr",
      defaultResponsibleEmployee: "Анна Заведующая",
      defaultResponsibleRole: "Заведующий производством",
      rows: [
        {
          id: "r1",
          date: "2026-09-21",
          responsibleEmployeeId: "gone",
          responsibleEmployee: "Акулинина Е.В.",
          responsibleRole: null,
        },
      ],
    },
    roster
  ) as { rows: Array<{ responsibleRole: string | null }> };
  // Ни должность документа, ни должность его ответственного («Управляющий»).
  assert.equal(config.rows[0].responsibleRole ?? null, null);
});

test("перештамповка берёт должность из справочника, а не устаревший positionTitle", () => {
  const baker: StaffBindingUser = {
    id: "baker",
    name: "Вера Кондитер",
    role: "cook",
    positionTitle: "Повар",
    jobPosition: { name: "Кондитер" },
  };
  const config = normalizeJournalStaffBoundConfig(
    "traceability_test",
    {
      rows: [
        { id: "r1", date: "2026-09-21", responsibleEmployeeId: "baker", responsibleEmployee: "Вера Кондитер", responsibleRole: "Повар" },
      ],
    },
    [...roster, baker]
  ) as { rows: Array<{ responsibleRole: string | null }> };
  assert.equal(config.rows[0].responsibleRole, "Кондитер");
});
