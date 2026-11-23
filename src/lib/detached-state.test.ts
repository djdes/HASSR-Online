import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDetachedState } from "@/lib/detached-state";

describe("createDetachedState", () => {
  it("хранит значение и отдаёт его", () => {
    const state = createDetachedState<string | null>(null);
    assert.equal(state.get(), null);
    state.set("edit");
    assert.equal(state.get(), "edit");
  });

  it("принимает функцию-обновитель, как useState", () => {
    const state = createDetachedState({ kind: "edit", pending: false });
    state.set((previous) => ({ ...previous, pending: true }));
    assert.deepEqual(state.get(), { kind: "edit", pending: true });
  });

  it("оповещает подписчиков только при настоящем изменении", () => {
    const state = createDetachedState(1);
    let calls = 0;
    const unsubscribe = state.subscribe(() => calls++);
    state.set(1);
    assert.equal(calls, 0, "то же значение — без оповещения");
    state.set(2);
    state.set((n) => n);
    assert.equal(calls, 1);
    unsubscribe();
    state.set(3);
    assert.equal(calls, 1, "после отписки — тишина");
  });

  it("отписка одного подписчика во время оповещения не теряет остальных", () => {
    const state = createDetachedState(0);
    const seen: string[] = [];
    const offA = state.subscribe(() => {
      seen.push("a");
      offA();
    });
    state.subscribe(() => seen.push("b"));
    state.set(1);
    state.set(2);
    assert.deepEqual(seen, ["a", "b", "b"]);
  });
});
