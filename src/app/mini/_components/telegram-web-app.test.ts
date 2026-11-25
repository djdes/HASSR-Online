import assert from "node:assert/strict";
import test from "node:test";

import {
  isInsideTelegram,
  requestTelegramContact,
  type TelegramContactRequestedEvent,
} from "./telegram-web-app";

type FakeWebApp = {
  initData?: string;
  platform?: string;
  requestContact?: (
    callback?: (sent: boolean, event?: TelegramContactRequestedEvent) => void,
  ) => void;
};

async function withWindowAsync(
  webApp: FakeWebApp | null | undefined,
  run: () => Promise<void>
): Promise<void> {
  const holder = globalThis as unknown as { window?: unknown };
  const had = "window" in holder;
  const previous = holder.window;
  holder.window =
    webApp === undefined ? {} : { Telegram: webApp === null ? undefined : { WebApp: webApp } };
  try {
    await run();
  } finally {
    if (had) holder.window = previous;
    else delete holder.window;
  }
}

function withWindow(
  webApp: FakeWebApp | null | undefined,
  run: () => void
): void {
  const holder = globalThis as unknown as { window?: unknown };
  const had = "window" in holder;
  const previous = holder.window;
  holder.window =
    webApp === undefined ? {} : { Telegram: webApp === null ? undefined : { WebApp: webApp } };
  try {
    run();
  } finally {
    if (had) holder.window = previous;
    else delete holder.window;
  }
}

test("нет объекта WebApp — значит не Telegram", () => {
  withWindow(undefined, () => {
    assert.equal(isInsideTelegram(), false);
  });
  withWindow(null, () => {
    assert.equal(isInsideTelegram(), false);
  });
});

test("обычная вкладка: объект есть, но данных и клиента нет", () => {
  withWindow({ initData: "", platform: "unknown" }, () => {
    assert.equal(isInsideTelegram(), false);
  });
  withWindow({ initData: "" }, () => {
    assert.equal(isInsideTelegram(), false);
  });
  withWindow({ initData: "", platform: "   " }, () => {
    assert.equal(isInsideTelegram(), false);
  });
});

test("подписанные данные есть — мы внутри Telegram", () => {
  withWindow({ initData: "query_id=AAA&hash=deadbeef", platform: "unknown" }, () => {
    assert.equal(isInsideTelegram(), true);
  });
});

test("клиент известен — мы внутри Telegram даже без данных", () => {
  withWindow({ initData: "", platform: "ios" }, () => {
    assert.equal(isInsideTelegram(), true);
  });
  withWindow({ initData: "", platform: "tdesktop" }, () => {
    assert.equal(isInsideTelegram(), true);
  });
});

test("requestTelegramContact возвращает unsupported вне Telegram или без метода", async () => {
  await withWindowAsync(undefined, async () => {
    assert.deepEqual(await requestTelegramContact(), { status: "unsupported" });
  });
  await withWindowAsync({ initData: "a=1", platform: "ios" }, async () => {
    assert.deepEqual(await requestTelegramContact(), { status: "unsupported" });
  });
});

test("requestTelegramContact передаёт подписанный response и игнорирует повторные вызовы", async () => {
  await withWindowAsync(
    {
      initData: "a=1",
      requestContact(cb) {
        cb?.(true, { status: "sent", response: "auth_date=1&contact=%7B%7D&hash=abc" });
        cb?.(false, { status: "cancelled" });
      },
    },
    async () => {
      assert.deepEqual(await requestTelegramContact(), {
        status: "sent",
        response: "auth_date=1&contact=%7B%7D&hash=abc",
      });
    },
  );
});

test("requestTelegramContact поддерживает старый клиент без event и отмену пользователем", async () => {
  await withWindowAsync(
    {
      initData: "a=1",
      requestContact(cb) {
        cb?.(true);
      },
    },
    async () => {
      assert.deepEqual(await requestTelegramContact(), { status: "sent" });
    },
  );
  await withWindowAsync(
    {
      initData: "a=1",
      requestContact(cb) {
        cb?.(false, { status: "cancelled" });
      },
    },
    async () => {
      assert.deepEqual(await requestTelegramContact(), { status: "cancelled" });
    },
  );
});

test("requestTelegramContact ловит исключение и завершается по таймауту", async () => {
  await withWindowAsync(
    {
      initData: "a=1",
      requestContact() {
        throw new Error("unsupported in old client");
      },
    },
    async () => {
      assert.deepEqual(await requestTelegramContact(), { status: "unsupported" });
    },
  );
  await withWindowAsync(
    {
      initData: "a=1",
      requestContact() {
        // never settles
      },
    },
    async () => {
      assert.deepEqual(await requestTelegramContact(20), { status: "cancelled" });
    },
  );
});
