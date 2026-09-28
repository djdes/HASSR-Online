import assert from "node:assert/strict";
import test from "node:test";

// Простая подделка DOM: замку нужны стили body, метки html и прокрутка окна.
const htmlAttrs = new Set<string>();
const htmlProps = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.document = {
  body: { style: {} as Record<string, string> },
  documentElement: {
    clientWidth: 400,
    style: {
      scrollBehavior: "",
      setProperty: (k: string, v: string) => htmlProps.set(k, v),
      removeProperty: (k: string) => htmlProps.delete(k),
    },
    setAttribute: (k: string) => htmlAttrs.add(k),
    removeAttribute: (k: string) => htmlAttrs.delete(k),
  },
};
g.window = { scrollY: 640, innerWidth: 400, scrollTo: () => undefined };

test("замок прокрутки отдаёт сдвиг страницы шапке, чтобы она не уезжала за верх экрана", async () => {
  const { lockBodyScroll, unlockBodyScroll } = await import("./use-body-scroll-lock");
  lockBodyScroll();
  // body прибит со сдвигом −640px — липкая шапка уехала бы вместе с ним.
  assert.equal((g.document as { body: { style: Record<string, string> } }).body.style.top, "-640px");
  assert.ok(htmlAttrs.has("data-body-locked"));
  assert.equal(htmlProps.get("--body-lock-y"), "640px");
  unlockBodyScroll();
  assert.ok(!htmlAttrs.has("data-body-locked"));
  assert.ok(!htmlProps.has("--body-lock-y"));
});
