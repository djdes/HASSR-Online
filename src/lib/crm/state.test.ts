import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { awaitingChannel, computeContactState } from "@/lib/crm/state";

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 7, 9, minutes));

describe("CRM: состояние контакта из ленты", () => {
  it("входящее без ответа — ждёт с первого неотвеченного", () => {
    const items = [
      { direction: "in", channel: "email", occurredAt: at(0) },
      { direction: "out", channel: "email", occurredAt: at(5) },
      { direction: "in", channel: "chat", occurredAt: at(10) },
      { direction: "in", channel: "email", occurredAt: at(20) },
    ];
    const state = computeContactState(items);
    assert.deepEqual(state.awaitingSince, at(10));
    assert.deepEqual(state.lastInboundAt, at(20));
    assert.deepEqual(state.lastOutboundAt, at(5));
    assert.deepEqual(state.lastActivityAt, at(20));
    assert.equal(awaitingChannel(items, state.awaitingSince), "chat");
  });

  it("наш ответ после входящего — не ждёт", () => {
    const state = computeContactState([
      { direction: "in", channel: "email", occurredAt: at(0) },
      { direction: "out", channel: "email", occurredAt: at(3) },
    ]);
    assert.equal(state.awaitingSince, null);
  });

  it("«Ответ не нужен» снимает ожидание, но не считается нашим письмом", () => {
    const state = computeContactState([
      { direction: "in", channel: "email", occurredAt: at(0) },
      { direction: "note", channel: "resolved", occurredAt: at(1) },
    ]);
    assert.equal(state.awaitingSince, null);
    assert.equal(state.lastOutboundAt, null);
  });

  it("события и заметки ответа не ждут", () => {
    const state = computeContactState([
      { direction: "event", channel: "signup", occurredAt: at(0) },
      { direction: "note", channel: "note", occurredAt: at(2) },
    ]);
    assert.equal(state.awaitingSince, null);
    assert.equal(state.lastInboundAt, null);
    assert.deepEqual(state.lastActivityAt, at(2));
  });

  it("пустая лента", () => {
    assert.deepEqual(computeContactState([]), { lastInboundAt: null, lastOutboundAt: null, lastActivityAt: null, awaitingSince: null });
  });
});
