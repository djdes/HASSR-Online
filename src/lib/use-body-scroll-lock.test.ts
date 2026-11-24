import assert from "node:assert/strict";
import test from "node:test";

// Простая подделка DOM: замку нужны стили body, метки html и прокрутка окна.
const htmlAttrs = new Set<string>();
const htmlProps = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
// `position` ставится через `setProperty` с приоритетом — подделка его помнит.
const bodyPriority = new Map<string, string>();
const bodyStyle: Record<string, unknown> = {};
bodyStyle.setProperty = (k: string, v: string, priority = "") => {
  bodyStyle[k] = v;
  bodyPriority.set(k, priority);
};
g.document = {
  body: { style: bodyStyle },
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
const scrolledTo: number[] = [];
g.window = { scrollY: 640, innerWidth: 400, scrollTo: (_x: number, y: number) => scrolledTo.push(y) };

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

test("замок прибивает body с !important — иначе его перебивает `position: relative !important` Radix-слоя", async () => {
  const { lockBodyScroll, unlockBodyScroll } = await import("./use-body-scroll-lock");
  bodyStyle.position = "";
  bodyPriority.clear();
  lockBodyScroll();
  assert.equal(bodyStyle.position, "fixed");
  assert.equal(bodyPriority.get("position"), "important");
  // Вложенное окно замок не трогает и не снимает раньше времени.
  lockBodyScroll();
  unlockBodyScroll();
  assert.equal(bodyStyle.position, "fixed");
  unlockBodyScroll();
  assert.equal(bodyStyle.position, "");
});

test("Radix-слои зовут замок только на сенсорных устройствах", async () => {
  const { readFileSync } = await import("node:fs");
  const lock = readFileSync(new URL("./use-body-scroll-lock.ts", import.meta.url), "utf8");
  assert.match(lock, /export function useTouchBodyScrollLock[\s\S]{0,200}isTouchDevice\(\)/);
  assert.match(lock, /matchMedia\("\(pointer: coarse\)"\)/);
  const sheet = readFileSync(new URL("../components/ui/bottom-sheet.tsx", import.meta.url), "utf8");
  const dialog = readFileSync(new URL("../components/ui/dialog.tsx", import.meta.url), "utf8");
  assert.match(sheet, /useTouchBodyScrollLock\(open\)/);
  assert.match(dialog, /<TouchBodyScrollLock \/>/);
});

test("страница сменилась под замком — новая начинается сверху и после закрытия слоя", async () => {
  const { lockBodyScroll, unlockBodyScroll, rebaseBodyScrollLock } = await import("./use-body-scroll-lock");
  // Без замка — ничего не делает.
  rebaseBodyScrollLock();
  assert.ok(!htmlProps.has("--body-lock-y"));
  lockBodyScroll();
  assert.equal(bodyStyle.top, "-640px");
  rebaseBodyScrollLock();
  assert.equal(bodyStyle.top, "0px");
  assert.equal(htmlProps.get("--body-lock-y"), "0px");
  scrolledTo.length = 0;
  unlockBodyScroll();
  assert.deepEqual(scrolledTo, [0]);
});
