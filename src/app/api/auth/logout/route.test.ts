import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { ALL_SESSION_COOKIES, LEGACY_AUX_COOKIES } from "@/lib/auth-cookies";
import { KIOSK_DEVICE_COOKIE } from "@/lib/kiosk-device";
import { MINI_SHELL_COOKIE } from "@/lib/mini-shell-cookie";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as kioskLock } from "@/app/api/kiosk/lock/route";

const env = process.env as Record<string, string | undefined>;
const savedNodeEnv = env.NODE_ENV;

type Line = { name: string; value: string; attrs: string[] };

function parse(line: string): Line {
  const [pair, ...attrs] = line.split(";").map((part) => part.trim());
  const eq = pair.indexOf("=");
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attrs: attrs.map((a) => a.toLowerCase()) };
}

function expired(line: Line): boolean {
  return line.value === "" && line.attrs.some((a) => a === "max-age=0" || (a.startsWith("expires=") && a.includes("1970")));
}

describe("POST /api/auth/logout — гасит все куки сессии", () => {
  afterEach(() => {
    env.NODE_ENV = savedNodeEnv;
  });

  for (const nodeEnv of ["production", "development"] as const) {
    it(`${nodeEnv}: каждое имя сессии, служебные next-auth и оболочка — с атрибутами установки`, async () => {
      env.NODE_ENV = nodeEnv;
      const response = await logout();
      assert.equal(response.status, 200);
      const lines = response.headers.getSetCookie().map(parse);
      for (const name of [...ALL_SESSION_COOKIES, ...LEGACY_AUX_COOKIES, MINI_SHELL_COOKIE]) {
        const line = lines.find((l) => l.name === name);
        assert.ok(line, `${name}: нет Set-Cookie`);
        assert.ok(expired(line), `${name}: не гаснет`);
        assert.ok(line.attrs.includes("path=/"), `${name}: путь не /`);
        assert.ok(!line.attrs.some((a) => a.startsWith("domain=")), `${name}: Domain при удалении`);
        const needsSecure = name.startsWith("__Secure-") || name.startsWith("__Host-") || nodeEnv === "production";
        assert.equal(line.attrs.includes("secure"), needsSecure, `${name}: Secure`);
      }
      // Кука оболочки раньше терялась: её строку стирал следующий cookies.set.
      assert.ok(lines.some((l) => l.name === MINI_SHELL_COOKIE));
    });
  }
});

describe("POST /api/kiosk/lock — гасит все имена сессии, планшет остаётся киоском", () => {
  afterEach(() => {
    env.NODE_ENV = savedNodeEnv;
  });

  it("production: все имена сессии с Secure, кука киоска и оболочки не трогаются", async () => {
    env.NODE_ENV = "production";
    const lines = (await kioskLock()).headers.getSetCookie().map(parse);
    for (const name of ALL_SESSION_COOKIES) {
      const line = lines.find((l) => l.name === name);
      assert.ok(line && expired(line), `${name}: не гаснет`);
      assert.ok(line.attrs.includes("secure"), `${name}: без Secure`);
    }
    assert.ok(!lines.some((l) => l.name === KIOSK_DEVICE_COOKIE || l.name === MINI_SHELL_COOKIE));
  });
});
