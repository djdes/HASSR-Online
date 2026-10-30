import assert from "node:assert/strict";
import test from "node:test";

import { clientDocumentRecipients, clientProposalSchema, defaultAddressee, defaultGreeting, deliverableEmail } from "./client-documents";

test("recipients: owner and accountant first, company and staff after, technical and duplicate addresses dropped", () => {
  const list = clientDocumentRecipients({
    owner: { name: "Ольга Руководитель", email: "olga@cafe.example" },
    company: { emails: ["info@cafe.example", "OLGA@cafe.example"], accountantEmail: "buh@cafe.example" },
    people: [
      { id: "1", name: "Повар", email: "79990000000@org.staff.local", isActive: true, archived: false, isRoot: false },
      { id: "2", name: "Мария", email: "maria@cafe.example", isActive: true, archived: false, isRoot: false },
      { id: "3", name: "Уволен", email: "old@cafe.example", isActive: false, archived: false, isRoot: false },
    ],
  });
  assert.deepEqual(
    list.map((item) => [item.email, item.source]),
    [
      ["olga@cafe.example", "owner"],
      ["buh@cafe.example", "accountant"],
      ["info@cafe.example", "company"],
      ["maria@cafe.example", "person"],
    ],
  );
  assert.deepEqual(clientDocumentRecipients(null), []);
  assert.equal(deliverableEmail("x@y.local.haccp"), null);
});

test("addressee and greeting come from the director, declined", () => {
  assert.equal(defaultAddressee({ name: "КУЛИКОВА ВИКТОРИЯ ВИКТОРОВНА", post: "ГЕНЕРАЛЬНЫЙ ДИРЕКТОР" }), "Генеральному директору Куликовой Виктории Викторовне");
  assert.equal(defaultGreeting("КУЛИКОВА ВИКТОРИЯ ВИКТОРОВНА"), "Уважаемая Виктория Викторовна!");
  assert.equal(defaultAddressee({ name: "Смирнов Иван Петрович", post: null }), "Руководителю Смирнову Ивану Петровичу");
  assert.equal(defaultAddressee({ name: null, post: "Директор" }), null);
  assert.equal(defaultGreeting("Куликова Виктория Викторовна"), "Уважаемая Виктория Викторовна!");
  assert.equal(defaultGreeting(null), "Добрый день!");
});

test("proposal form defaults: Standard, extras on, empty strings become null", () => {
  const parsed = clientProposalSchema.parse({ addressee: "", greeting: "  ", promoCode: "" });
  assert.deepEqual(parsed, { plan: "standard", addressee: null, greeting: null, extras: { ppk: true, equipment: true }, promoCode: null });
});
