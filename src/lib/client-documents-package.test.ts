import assert from "node:assert/strict";
import test from "node:test";

import { defaultPackageMessage, defaultPackageSubject, packageAttachmentList } from "./client-documents-package";

test("письмо пакета: перечисляет только выбранные документы и подсказывает следующий шаг", () => {
  const all = defaultPackageMessage({
    companyName: "ООО «Солянка»",
    docs: ["contract", "invoice", "requisites"],
    contract: { number: "2026/7748", date: "2026-11-12" },
    invoice: { id: 45, amountRub: 47880 },
  });
  assert.match(all, /договор № 2026\/7748 от 12\.11\.2026;/);
  assert.match(all, /счёт № 45 на 47 880 ₽/);
  assert.match(all, /карточка организации ООО «БФС» с реквизитами\./);
  assert.match(all, /Подпишите договор/);
  assert.match(all, /После оплаты/);

  const onlyCard = defaultPackageMessage({ companyName: "", docs: ["requisites"], contract: null, invoice: null });
  assert.doesNotMatch(onlyCard, /договор №|счёт №|Подпишите|После оплаты/);
  assert.equal(defaultPackageSubject("ООО «Солянка»"), "Документы WeSetup для ООО «Солянка»");
  assert.match(packageAttachmentList(["a<b>.pdf"]), /a&lt;b&gt;\.pdf/);
});
