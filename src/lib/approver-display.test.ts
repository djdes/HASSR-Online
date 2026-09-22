import assert from "node:assert/strict";
import test from "node:test";

import {
  decideApproverFix,
  normalizeTitleKey,
  resolveApprover,
  resolveResponsible,
  type PersonDisplayUser,
} from "@/lib/approver-display";

const head: PersonDisplayUser = {
  id: "head",
  name: "Овчинникова Ольга",
  role: "manager",
  jobPosition: { name: "Заведующий производством" },
};
const cook: PersonDisplayUser = {
  id: "cook",
  name: "Абдулкадирова Индира Алиевна",
  role: "cook",
  jobPosition: { name: "Повар" },
};
const cook2: PersonDisplayUser = { id: "cook2", name: "Борисова Анна", role: "cook", positionTitle: "Повар" };
const users = [head, cook, cook2];

test("resolveApprover: должность и ФИО — из карточки человека", () => {
  assert.deepEqual(
    resolveApprover(
      { approveEmployeeId: "cook", approveEmployee: "Старое ФИО", approveRole: "Заведующий производством" },
      users
    ),
    { title: "Повар", name: "Абдулкадирова Индира Алиевна" }
  );
});

test("resolveApprover: человека нет в списке — сохранённые строки", () => {
  assert.deepEqual(
    resolveApprover({ approveEmployeeId: "gone", approveEmployee: " Уволенный ", approveRole: "Шеф" }, users),
    { title: "Шеф", name: "Уволенный" }
  );
  assert.deepEqual(resolveApprover({ approveEmployee: "Имя", approveRole: "Роль" }, null), {
    title: "Роль",
    name: "Имя",
  });
  assert.deepEqual(resolveApprover(null, users), { title: "", name: "" });
});

test("resolveResponsible — та же логика для ответственного", () => {
  assert.deepEqual(
    resolveResponsible(
      { responsibleEmployeeId: "head", responsibleEmployee: "", responsibleRole: "Управляющий" },
      users
    ),
    { title: "Заведующий производством", name: "Овчинникова Ольга" }
  );
});

test("normalizeTitleKey: регистр, ё, пробелы и род", () => {
  assert.equal(normalizeTitleKey(" Заведующая  производством"), normalizeTitleKey("заведующий производством"));
  assert.equal(normalizeTitleKey("Шеф-повар"), normalizeTitleKey("шеф-повар "));
});

test("decideApproverFix: случай заказчика — утверждающим становится ответственный", () => {
  const fix = decideApproverFix({
    config: {
      approveEmployeeId: "cook",
      approveEmployee: "Абдулкадирова Индира Алиевна",
      approveRole: "Заведующий производством",
      responsibleEmployeeId: "head",
    },
    users,
  });
  assert.deepEqual(fix, {
    rule: "responsible",
    approveEmployeeId: "head",
    approveEmployee: "Овчинникова Ольга",
    approveRole: "Заведующий производством",
  });
});

test("decideApproverFix: ответственный из документа, если в конфиге нет", () => {
  const fix = decideApproverFix({
    config: { approveEmployeeId: "cook", approveRole: "Заведующая производством" },
    documentResponsibleUserId: "head",
    users: [...users, { id: "head2", name: "Вторая", role: "manager", positionTitle: "Заведующий производством" }],
  });
  assert.equal(fix?.rule, "responsible");
  assert.equal(fix?.approveEmployeeId, "head");
});

test("decideApproverFix: единственный сотрудник с этой должностью", () => {
  const fix = decideApproverFix({
    config: { approveEmployeeId: "cook", approveRole: "Заведующий производством", responsibleEmployeeId: "cook2" },
    users,
  });
  assert.equal(fix?.rule, "single-holder");
  assert.equal(fix?.approveEmployeeId, "head");
});

test("decideApproverFix: несколько или ни одного — должность человека", () => {
  const fix = decideApproverFix({
    config: { approveEmployeeId: "head", approveRole: "Повар" },
    users,
  });
  assert.deepEqual(fix, {
    rule: "keep-person",
    approveEmployeeId: "head",
    approveEmployee: "Овчинникова Ольга",
    approveRole: "Заведующий производством",
  });
  const none = decideApproverFix({ config: { approveEmployeeId: "cook", approveRole: "Директор" }, users });
  assert.equal(none?.rule, "keep-person");
  assert.equal(none?.approveRole, "Повар");
});

test("decideApproverFix: совпадает или утверждающего нет — не трогаем", () => {
  assert.equal(decideApproverFix({ config: { approveEmployeeId: "cook", approveRole: "повар" }, users }), null);
  assert.equal(
    decideApproverFix({ config: { approveEmployeeId: "head", approveRole: "Заведующая производством" }, users }),
    null
  );
  assert.equal(decideApproverFix({ config: { approveEmployeeId: "gone", approveRole: "Шеф" }, users }), null);
  assert.equal(decideApproverFix({ config: { approveRole: "Шеф" }, users }), null);
});
