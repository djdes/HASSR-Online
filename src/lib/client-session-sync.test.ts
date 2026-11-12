import assert from "node:assert/strict";
import test from "node:test";
import type { Session } from "next-auth";
import { needsClientSessionReread, sessionSignature } from "./client-session-sync";

function session(user: Partial<Session["user"]>, expires = "2027-01-01T00:00:00.000Z"): Session {
  return { expires, user: { id: "u1", role: "owner", organizationId: "home", ...user } as Session["user"] };
}

test("signature follows the user part only, not the expiry", () => {
  assert.equal(
    sessionSignature(session({ activeOrganizationId: "b" })),
    sessionSignature(session({ activeOrganizationId: "b" }, "2027-02-02T00:00:00.000Z")),
  );
  assert.notEqual(sessionSignature(session({ activeOrganizationId: "a" })), sessionSignature(session({ activeOrganizationId: "b" })));
  assert.notEqual(sessionSignature(session({ role: "owner" })), sessionSignature(session({ role: "cook" })));
  assert.equal(sessionSignature(null), "");
  assert.equal(sessionSignature(undefined), "");
});

test("re-read only when the server session changed and the client is behind", () => {
  const a = sessionSignature(session({ activeOrganizationId: "a" }));
  const b = sessionSignature(session({ activeOrganizationId: "b" }));
  // Первый рендер: провайдер взял сессию из того же пропса.
  assert.equal(needsClientSessionReread({ previousServer: a, server: a, client: a }), false);
  // Смена организации: сервер прислал B, клиент ещё на A.
  assert.equal(needsClientSessionReread({ previousServer: a, server: b, client: a }), true);
  // Клиент уже догнал (перечитал сам или вкладка-соседка).
  assert.equal(needsClientSessionReread({ previousServer: a, server: b, client: b }), false);
  // Сервер не менялся, а клиент другой (вход в мини-приложении на клиенте) — не трогаем.
  assert.equal(needsClientSessionReread({ previousServer: "", server: "", client: a }), false);
  // Сервер без сессии (выход) — выходом занимается сам выход.
  assert.equal(needsClientSessionReread({ previousServer: a, server: "", client: a }), false);
});
