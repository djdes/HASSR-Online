import assert from "node:assert/strict";
import test from "node:test";

import {
  getPpeIssuanceRecipientLabel,
  type PpeIssuanceRow,
} from "@/lib/ppe-issuance-document";

/**
 * «Должность и ФИО лица, получившего СИЗ» — должность самого получателя
 * из его карточки, а не сохранённая в строке копия (туда подставлялся лейбл
 * роли или должность по умолчанию).
 */
const row = {
  id: "r1",
  recipientUserId: "u1",
  recipientName: "Акулинина Е.В.",
  recipientTitle: "Управляющий",
} as PpeIssuanceRow;

test("СИЗ: должность получателя берётся из его карточки", () => {
  const users = [
    { id: "u1", name: "Акулинина Е.В.", role: "cook", jobPosition: { name: "Кладовщик" } },
  ];
  assert.equal(getPpeIssuanceRecipientLabel(row, users), "Кладовщик, Акулинина Е.В.");
});

test("СИЗ: уволенный получатель — сохранённые должность и имя", () => {
  assert.equal(getPpeIssuanceRecipientLabel(row, []), "Управляющий, Акулинина Е.В.");
});
