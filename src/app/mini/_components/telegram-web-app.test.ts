import assert from "node:assert/strict";
import test from "node:test";

import { isInsideTelegram } from "./telegram-web-app";

type FakeWebApp = {
  initData?: string;
  platform?: string;
};

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
