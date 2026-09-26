import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LOGOUT_URL,
  SIGNED_OUT_MARK_KEY,
  browserMarkStorage,
  clearSignedOutMark,
  isSignedOutManually,
  markSignedOut,
  miniEntryStep,
  signOutOnThisDevice,
  telegramSignInHref,
  type MarkStorage,
} from "@/app/mini/_lib/signed-out-mark";

/** localStorage на Map — как в браузере, только без браузера. */
function memoryStorage(): MarkStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, String(value)),
    removeItem: (key) => void data.delete(key),
  };
}

/** Хранилище, которое бросает на любое обращение (запрет данных сайтов). */
const brokenStorage: MarkStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("пометка «вышел вручную»", () => {
  it("ставится, читается и снимается", () => {
    const storage = memoryStorage();
    assert.equal(isSignedOutManually(storage), false);
    assert.equal(markSignedOut(storage, 1_700_000_000_000), true);
    assert.equal(storage.data.get(SIGNED_OUT_MARK_KEY), "1700000000000");
    assert.equal(isSignedOutManually(storage), true);
    clearSignedOutMark(storage);
    assert.equal(isSignedOutManually(storage), false);
    assert.equal(storage.data.has(SIGNED_OUT_MARK_KEY), false);
  });

  it("пустое значение пометкой не считается", () => {
    const storage = memoryStorage();
    storage.data.set(SIGNED_OUT_MARK_KEY, "");
    assert.equal(isSignedOutManually(storage), false);
  });

  it("хранилище бросает — ничего не падает, пометки нет", () => {
    // try/catch обязателен: иначе приватный режим ломал бы и выход, и вход.
    assert.doesNotThrow(() => markSignedOut(brokenStorage));
    assert.equal(markSignedOut(brokenStorage), false);
    assert.doesNotThrow(() => clearSignedOutMark(brokenStorage));
    assert.equal(isSignedOutManually(brokenStorage), false);
  });

  it("хранилища нет вовсе — тоже без ошибок", () => {
    assert.equal(markSignedOut(null), false);
    assert.doesNotThrow(() => clearSignedOutMark(null));
    assert.equal(isSignedOutManually(null), false);
  });

  it("вне браузера и при запрете доступа к localStorage хранилища нет", () => {
    assert.equal(browserMarkStorage(), null);
    const g = globalThis as { window?: unknown };
    const previous = g.window;
    g.window = Object.defineProperty({}, "localStorage", {
      get() {
        throw new Error("SecurityError: access denied");
      },
    });
    try {
      assert.equal(browserMarkStorage(), null);
      assert.equal(isSignedOutManually(), false);
      assert.equal(markSignedOut(), false);
    } finally {
      g.window = previous;
    }
  });
});

describe("miniEntryStep — что делать /mini без сессии", () => {
  it("в Telegram без пометки входит по initData, как раньше", () => {
    assert.equal(miniEntryStep({ hasInitData: true, signedOut: false }), "telegram-sign-in");
  });

  it("в Telegram после «Выйти» сам не входит — экран входа", () => {
    assert.equal(miniEntryStep({ hasInitData: true, signedOut: true }), "login-screen");
  });

  it("вне Telegram пометка ничего не меняет — кука или форма входа", () => {
    assert.equal(miniEntryStep({ hasInitData: false, signedOut: false }), "cookie-or-login");
    assert.equal(miniEntryStep({ hasInitData: false, signedOut: true }), "cookie-or-login");
  });

  it("полный цикл: вышел → экран входа, вошёл (пометка снята) → снова автовход", () => {
    const storage = memoryStorage();
    markSignedOut(storage);
    assert.equal(
      miniEntryStep({ hasInitData: true, signedOut: isSignedOutManually(storage) }),
      "login-screen",
    );
    clearSignedOutMark(storage);
    assert.equal(
      miniEntryStep({ hasInitData: true, signedOut: isSignedOutManually(storage) }),
      "telegram-sign-in",
    );
  });
});

describe("telegramSignInHref — куда ведёт «Войти через Telegram»", () => {
  it("без цели — на /mini, там вход по Telegram", () => {
    assert.equal(telegramSignInHref(undefined), "/mini");
    assert.equal(telegramSignInHref(null), "/mini");
    assert.equal(telegramSignInHref(""), "/mini");
  });

  it("цель уже /mini?next=… (её строит сам /mini) — берём как есть", () => {
    assert.equal(telegramSignInHref("/mini"), "/mini");
    assert.equal(
      telegramSignInHref("/mini?next=%2Fjournals%2Fhygiene"),
      "/mini?next=%2Fjournals%2Fhygiene",
    );
  });

  it("страница кабинета — через /mini с возвратом на неё", () => {
    assert.equal(
      telegramSignInHref("/journals/hygiene"),
      "/mini?next=%2Fjournals%2Fhygiene",
    );
  });

  it("экран входа и корень сайта целью не бывают", () => {
    assert.equal(telegramSignInHref("/mini/login"), "/mini");
    assert.equal(telegramSignInHref("/mini/login?next=%2Fmini"), "/mini");
    assert.equal(telegramSignInHref("/"), "/mini");
  });

  it("чужой адрес и /api отбрасываем — открытого редиректа нет", () => {
    assert.equal(telegramSignInHref("//evil.example/x"), "/mini");
    assert.equal(telegramSignInHref("https://evil.example/x"), "/mini");
    assert.equal(telegramSignInHref("/api/auth/logout"), "/mini");
  });
});

describe("signOutOnThisDevice — полный выход, как на сайте, плюс пометка", () => {
  function recorder(logoutStatus = 200) {
    const calls: string[] = [];
    const fetchCalls: Array<{ input: string; init: RequestInit }> = [];
    const storage = memoryStorage();
    const trackedStorage: MarkStorage = {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => {
        calls.push("mark");
        storage.setItem(key, value);
      },
      removeItem: (key) => storage.removeItem(key),
    };
    return {
      calls,
      fetchCalls,
      storage,
      trackedStorage,
      fetch: async (input: string, init: RequestInit) => {
        calls.push("logout");
        fetchCalls.push({ input, init });
        return { ok: logoutStatus >= 200 && logoutStatus < 300, status: logoutStatus };
      },
    };
  }

  it("POST /api/auth/logout → пометка → signOut, именно в таком порядке", async () => {
    const r = recorder();
    await signOutOnThisDevice({
      fetch: r.fetch,
      signOut: async () => {
        r.calls.push("signOut");
      },
      storage: r.trackedStorage,
    });
    assert.deepEqual(r.calls, ["logout", "mark", "signOut"]);
    assert.deepEqual(r.fetchCalls, [{ input: "/api/auth/logout", init: { method: "POST" } }]);
    assert.equal(isSignedOutManually(r.storage), true);
  });

  it("сервер не подтвердил выход — ошибка, пометки нет, signOut не зовём", async () => {
    const r = recorder(500);
    let signOutCalled = false;
    await assert.rejects(
      signOutOnThisDevice({
        fetch: r.fetch,
        signOut: async () => {
          signOutCalled = true;
        },
        storage: r.storage,
      }),
    );
    assert.equal(isSignedOutManually(r.storage), false);
    assert.equal(signOutCalled, false);
  });

  it("нет связи — ошибка, пометки нет", async () => {
    const storage = memoryStorage();
    await assert.rejects(
      signOutOnThisDevice({
        fetch: async () => {
          throw new TypeError("Failed to fetch");
        },
        signOut: async () => undefined,
        storage,
      }),
    );
    assert.equal(isSignedOutManually(storage), false);
  });

  it("сбой signOut не отменяет выход: сессии на сервере уже нет", async () => {
    const r = recorder();
    await signOutOnThisDevice({
      fetch: r.fetch,
      signOut: async () => {
        throw new Error("csrf fetch failed");
      },
      storage: r.storage,
    });
    assert.equal(isSignedOutManually(r.storage), true);
  });

  it("зависший signOut не держит человека на экране дольше таймаута", async () => {
    const r = recorder();
    const started = Date.now();
    await signOutOnThisDevice({
      fetch: r.fetch,
      signOut: () => new Promise(() => {}),
      storage: r.storage,
      timeoutMs: 20,
    });
    assert.ok(Date.now() - started < 2000);
    assert.equal(isSignedOutManually(r.storage), true);
  });

  it("другой адрес выхода (киоск, «на всех устройствах») — тот же порядок", async () => {
    for (const logoutUrl of ["/api/kiosk/lock", "/api/security/logout-all"]) {
      const r = recorder();
      await signOutOnThisDevice({
        fetch: r.fetch,
        signOut: async () => {
          r.calls.push("signOut");
        },
        storage: r.trackedStorage,
        logoutUrl,
      });
      assert.deepEqual(r.fetchCalls, [{ input: logoutUrl, init: { method: "POST" } }]);
      assert.deepEqual(r.calls, ["logout", "mark", "signOut"]);
    }
  });

  it("по умолчанию — POST /api/auth/logout (LOGOUT_URL)", async () => {
    const r = recorder();
    await signOutOnThisDevice({ fetch: r.fetch, signOut: async () => undefined, storage: r.storage });
    assert.equal(r.fetchCalls[0]?.input, LOGOUT_URL);
    assert.equal(LOGOUT_URL, "/api/auth/logout");
  });

  it("хранилище недоступно — выход всё равно проходит", async () => {
    const r = recorder();
    let signOutCalled = false;
    await signOutOnThisDevice({
      fetch: r.fetch,
      signOut: async () => {
        signOutCalled = true;
      },
      storage: brokenStorage,
    });
    assert.equal(signOutCalled, true);
  });
});
