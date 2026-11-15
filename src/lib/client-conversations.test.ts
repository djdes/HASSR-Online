import assert from "node:assert/strict";
import test from "node:test";

import { clientIdentityKeys } from "@/lib/client-conversations.server";
import type { ClientContacts } from "@/lib/root-client-card.server";

test("ключи клиента: почты в нижнем регистре, телефоны по 10 цифрам, без сотрудников платформы", () => {
  const contacts = {
    owner: null,
    requisites: null,
    company: { phones: ["8 (495) 109-65-43"], emails: ["Info@Kafe.ru"], accountantEmail: "buh@kafe.ru", website: null, address: null },
    people: [
      { isRoot: false, email: "Anna@Kafe.ru", loginEmail: null, phone: "+7 925 305-80-77" },
      { isRoot: true, email: "admin@wesetup.ru", loginEmail: null, phone: "+7 999 000-00-00" },
    ],
  } as unknown as ClientContacts;
  const keys = clientIdentityKeys(contacts);
  assert.deepEqual(keys.emails.sort(), ["anna@kafe.ru", "buh@kafe.ru", "info@kafe.ru"]);
  assert.deepEqual(keys.phoneKeys.sort(), ["4951096543", "9253058077"]);
  assert.deepEqual(clientIdentityKeys(null), { emails: [], phoneKeys: [] });
});
