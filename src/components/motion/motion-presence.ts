import {
  SHEET_GRAB_ZONE_PX,
  enterDelays,
  isJournalSave,
  isSoleAddition,
  looksLikePlaceholder,
  sheetDragCloses,
} from "@/components/motion/motion-model";

/**
 * Motion for what appears and disappears (spec `.agent/tasks/site-motion-round2-2026-11-22`).
 * Like the rest of the runtime it watches the page instead of changing components — the screens
 * that build windows, tables and placeholders by hand are many and share no code.
 *
 * • Content that replaces a placeholder appears element by element (AC1).
 * • A row added alone to a table that is already on the screen arrives with a tint (AC2).
 * • After a save accepted by the journal API the cell touched last shows a check (AC3).
 * • A hand-built window that is removed plays out through a copy of itself (AC4).
 * • On a phone a hand-built sheet can be pulled down to close (AC5).
 *
 * Styles: `src/app/motion.css`, sections 8–11. Started by `MotionRuntime`.
 */

const PLACEHOLDER = ".skeleton-shimmer, .animate-pulse";
/** A window built by hand: not the `Dialog` primitive, not another Radix layer, not a vaul sheet, not our copy. */
const WINDOW =
  ':is([role="dialog"], [role="alertdialog"]):not([data-slot], [data-state], [data-vaul-drawer], [data-motion-ghost])';
const BACKDROP = '[class~="fixed"][class~="inset-0"]';
const CARD = '[class*="rounded-"]:not([class~="absolute"], [class~="fixed"])';
const CLOSE_BUTTON = 'button[aria-label*="акрыть"], button[aria-label*="lose"], button[aria-label*="opish"]';
const TABLE_PART = /^(TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|COLGROUP|COL|CAPTION)$/;

const ENTER_MS = 320;
const ROW_NEW_MS = 1800;
const SAVED_MS = 1500;
const WINDOW_OUT_MS = 160;
const SHEET_OUT_MS = 220;
const PHONE_WIDTH = 640;

function motionOff(): boolean {
  if (document.documentElement.hasAttribute("data-view-still")) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function animate(element: Element, frames: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  if (typeof element.animate !== "function") return null;
  try {
    return element.animate(frames, options);
  } catch {
    try {
      return element.animate(frames, { ...options, easing: "ease-out" });
    } catch {
      return null;
    }
  }
}

/* ── AC1: content after a placeholder ─────────────────────────────────────────────────────── */

function isPlaceholder(element: Element): boolean {
  const shimmer = element.matches(PLACEHOLDER) || element.querySelector(PLACEHOLDER) !== null;
  if (!shimmer) return false;
  return looksLikePlaceholder(shimmer, (element.textContent ?? "").trim().length);
}

/** A rise needs a transform; a transform would capture fixed descendants for the time it plays. */
function mayRise(element: Element): boolean {
  if (TABLE_PART.test(element.tagName)) return false;
  return element.querySelector('[class*="fixed"]') === null;
}

function enter(elements: Element[]): void {
  let targets = elements;
  // One wrapper came in: let its blocks arrive one after another.
  if (targets.length === 1 && !TABLE_PART.test(targets[0].tagName)) {
    const children = Array.from(targets[0].children);
    if (children.length >= 2 && children.length <= 12) targets = children;
  }
  const easing = token("--spring-soft", "ease-out");
  enterDelays(targets.length).forEach((delay, index) => {
    const target = targets[index];
    const rise = mayRise(target);
    // Only the first frame is given: the element arrives at whatever it looks like itself
    // (a dimmed block stays dimmed).
    animate(target, [rise ? { opacity: 0, translate: "0 8px", offset: 0 } : { opacity: 0, offset: 0 }], {
      duration: ENTER_MS,
      delay,
      easing,
      fill: "backwards",
    });
  });
}

/* ── AC2: a new row ───────────────────────────────────────────────────────────────────────── */

/** The «no rows yet» line of a table: one wide cell and nothing to fill in. */
function isEmptyMarker(element: Element): boolean {
  if (element.hasAttribute("data-empty-row")) return true;
  if (element.tagName !== "TR" || element.children.length > 2) return false;
  const wide = Array.from(element.children).some((cell) => (cell as HTMLTableCellElement).colSpan > 2);
  return wide && element.querySelector("input, select, textarea") === null;
}

const rowTimers = new WeakMap<Element, number>();

function markNew(row: Element): void {
  window.clearTimeout(rowTimers.get(row));
  row.setAttribute("data-row-new", "");
  rowTimers.set(
    row,
    window.setTimeout(() => row.removeAttribute("data-row-new"), ROW_NEW_MS),
  );
}

/* ── AC3: a saved mark ────────────────────────────────────────────────────────────────────── */

let lastCell: Element | null = null;

function onTouch(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const cell = target.closest('td, th, [role="gridcell"]');
  if (cell && cell.closest("main, .mini-root")) {
    lastCell = cell;
    return;
  }
  // Working inside a layer opened from the cell (a window, a list, a menu) keeps the cell.
  if (target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-sonner-toaster]')) return;
  if (event.type === "pointerdown") lastCell = null;
}

function showSaved(): void {
  const cell = lastCell;
  if (!cell || !cell.isConnected) return;
  const box = cell.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return;
  // A node of its own on <body>, like a portal: the cell keeps its styles (a sticky column
  // must stay sticky), React does not own this place.
  const mark = document.createElement("span");
  mark.setAttribute("data-motion-saved", "");
  mark.setAttribute("aria-hidden", "true");
  mark.style.left = `${Math.round(box.right + window.scrollX - 18)}px`;
  mark.style.top = `${Math.round(box.top + window.scrollY + 3)}px`;
  document.body.appendChild(mark);
  window.setTimeout(() => mark.remove(), SAVED_MS);
}

type FetchLike = typeof window.fetch;
let originalFetch: FetchLike | null = null;
let wrappedFetch: FetchLike | null = null;

function watchSaves(): void {
  if (originalFetch || typeof window.fetch !== "function") return;
  const original = window.fetch;
  originalFetch = original;
  // The original promise is returned untouched: the caller reads the response as before.
  wrappedFetch = function fetchWithSavedMark(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const promise = original.call(window, input, init);
    try {
      const method = init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET");
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (lastCell && isJournalSave(method, url)) {
        promise.then(
          (response) => {
            if (response.ok) showSaved();
          },
          () => undefined,
        );
      }
    } catch {
      /* the mark is decoration: a request must never fail because of it */
    }
    return promise;
  } as FetchLike;
  window.fetch = wrappedFetch;
}

function unwatchSaves(): void {
  if (originalFetch && window.fetch === wrappedFetch) window.fetch = originalFetch;
  originalFetch = null;
  wrappedFetch = null;
}

/* ── AC4: a hand-built window plays out ───────────────────────────────────────────────────── */

const scrolled = new WeakMap<Element, [top: number, left: number]>();

function onScroll(event: Event): void {
  const target = event.target;
  if (target instanceof Element) scrolled.set(target, [target.scrollTop, target.scrollLeft]);
}

/** The window inside a removed node: the node itself, or the window under a full-screen backdrop. */
function windowIn(node: Element): Element | null {
  if (node.hasAttribute("data-motion-ghost")) return null;
  if (node.matches(WINDOW)) return node;
  if (!node.matches(BACKDROP)) return null;
  return node.querySelector(`:scope > ${WINDOW}, :scope > * > ${WINDOW}`);
}

/** The card that moves: the window itself, or its card when the role sits on the full-screen wrapper. */
function cardOf(windowElement: Element): Element {
  if (!windowElement.matches(BACKDROP)) return windowElement;
  return windowElement.querySelector(`:scope > ${CARD}`) ?? windowElement;
}

/** Fields, scroll positions: what `cloneNode` does not carry over. */
function carryState(from: Element, to: Element): void {
  const source = document.createTreeWalker(from, NodeFilter.SHOW_ELEMENT);
  const target = document.createTreeWalker(to, NodeFilter.SHOW_ELEMENT);
  let a: Node | null = from;
  let b: Node | null = to;
  while (a && b) {
    if (a instanceof HTMLInputElement && b instanceof HTMLInputElement) {
      b.checked = a.checked;
      if (a.type !== "file") b.value = a.value;
    } else if (a instanceof HTMLTextAreaElement && b instanceof HTMLTextAreaElement) {
      b.value = a.value;
    } else if (a instanceof HTMLSelectElement && b instanceof HTMLSelectElement) {
      b.selectedIndex = a.selectedIndex;
    }
    const position = scrolled.get(a as Element);
    if (position) {
      (b as Element).scrollTop = position[0];
      (b as Element).scrollLeft = position[1];
    }
    a = source.nextNode();
    b = target.nextNode();
  }
}

function playOut(node: Element, parent: Node, before: Node | null): void {
  let ghost: HTMLElement | null = null;
  const done = () => ghost?.remove();
  try {
    ghost = node.cloneNode(true) as HTMLElement;
    // The copy only plays the exit: no clicks, no focus, nothing for a screen reader, no ids
    // or field names that could collide with a window opened again.
    ghost.setAttribute("data-motion-ghost", "");
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("inert", "");
    for (const element of ghost.querySelectorAll("iframe, video, audio, object, embed")) element.removeAttribute("src");
    parent.insertBefore(ghost, before && before.parentNode === parent ? before : null);
    // While the two trees still match node for node.
    carryState(node, ghost);
    for (const element of ghost.querySelectorAll("script")) element.remove();
    for (const element of [ghost, ...Array.from(ghost.querySelectorAll("[id], [name]"))]) {
      element.removeAttribute("id");
      element.removeAttribute("name");
    }

    const windowElement = ghost.matches(WINDOW.replace(", [data-motion-ghost]", "")) ? ghost : (ghost.querySelector(WINDOW) ?? ghost);
    const card = cardOf(windowElement);
    const sheet = window.innerWidth < PHONE_WIDTH && /(^|\s)([a-z-]+:)*rounded-t-/.test(card.getAttribute("class") ?? "");
    const running: Array<Animation | null> = [];
    if (sheet) {
      running.push(animate(card, [{ transform: "translateY(0)" }, { transform: "translateY(110%)" }], { duration: SHEET_OUT_MS, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" }));
    } else {
      running.push(animate(card, [{ opacity: 1, scale: "1" }, { opacity: 0, scale: "0.97" }], { duration: WINDOW_OUT_MS, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" }));
    }
    if (card !== ghost) {
      running.push(animate(ghost, [{ opacity: 1 }, { opacity: 0 }], { duration: sheet ? SHEET_OUT_MS : WINDOW_OUT_MS, easing: "ease-in", fill: "forwards" }));
    }
    const live = running.filter((animation): animation is Animation => animation !== null);
    if (live.length === 0) return done();
    void Promise.allSettled(live.map((animation) => animation.finished)).then(done);
    window.setTimeout(done, SHEET_OUT_MS + 400); // whatever happens, the copy does not stay
  } catch {
    done();
  }
}

/* ── AC5: pull a sheet down on a phone ────────────────────────────────────────────────────── */

type Drag = { card: HTMLElement; close: HTMLElement; startY: number; offset: number };
let drag: Drag | null = null;

/**
 * The window's own close button: one labelled «Закрыть», or the cross in the header (the top
 * zone of the card — a cross further down clears a field, it does not close the window).
 */
function closeButtonOf(card: HTMLElement): HTMLElement | null {
  const top = card.getBoundingClientRect().top;
  const inHeader = (button: HTMLElement) => button.getBoundingClientRect().top - top <= SHEET_GRAB_ZONE_PX;
  const usable = (button: HTMLElement) => !(button as HTMLButtonElement).disabled && inHeader(button);
  const labelled = Array.from(card.querySelectorAll<HTMLElement>(CLOSE_BUTTON)).find(usable);
  if (labelled) return labelled;
  return Array.from(card.querySelectorAll<HTMLElement>("button")).find((button) => button.querySelector(":scope > svg.lucide-x") !== null && usable(button)) ?? null;
}

function onTouchStart(event: TouchEvent): void {
  drag = null;
  if (window.innerWidth >= PHONE_WIDTH || event.touches.length !== 1 || motionOff()) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const windowElement = target.closest(WINDOW);
  if (!windowElement) return;
  const card = cardOf(windowElement) as HTMLElement;
  if (!card.contains(target) || !/(^|\s)([a-z-]+:)*rounded-t-/.test(card.getAttribute("class") ?? "")) return;
  const touch = event.touches[0];
  if (touch.clientY - card.getBoundingClientRect().top > SHEET_GRAB_ZONE_PX) return;
  // A list scrolled away from its top is being scrolled, not the sheet pulled.
  for (let node: Element | null = target; node && node !== card.parentElement; node = node.parentElement) {
    if (node.scrollTop > 0) return;
  }
  const close = closeButtonOf(card);
  if (!close) return; // a sheet that cannot be closed stays put
  drag = { card, close, startY: touch.clientY, offset: 0 };
}

function onTouchMove(event: TouchEvent): void {
  if (!drag) return;
  const offset = event.touches[0].clientY - drag.startY;
  drag.offset = offset > 0 ? offset : 0;
  drag.card.style.setProperty("translate", `0 ${drag.offset}px`);
  drag.card.style.setProperty("transition", "none");
}

function settle(card: HTMLElement, from: number): void {
  card.style.removeProperty("translate");
  card.style.removeProperty("transition");
  if (from > 0) animate(card, [{ translate: `0 ${from}px` }, { translate: "0 0" }], { duration: 420, easing: token("--spring", "ease-out") });
}

function onTouchEnd(): void {
  const current = drag;
  drag = null;
  if (!current) return;
  if (!sheetDragCloses(current.offset)) return settle(current.card, current.offset);
  // Close the way the window closes itself; the copy that plays out starts from where the
  // finger left the sheet. A window that refuses to close goes back.
  current.close.click();
  window.setTimeout(() => {
    if (current.card.isConnected) settle(current.card, current.offset);
  }, 350);
}

/* ── One observer for what is added and removed ───────────────────────────────────────────── */

function elements(nodes: Iterable<Node>): Element[] {
  const list: Element[] = [];
  for (const node of nodes) if (node instanceof Element) list.push(node);
  return list;
}

function onTree(records: MutationRecord[]): void {
  if (motionOff()) return;
  const added = new Set<Node>();
  const removed = new Set<Node>();
  for (const record of records) {
    record.addedNodes.forEach((node) => added.add(node));
    record.removedNodes.forEach((node) => removed.add(node));
  }
  const addedBy = new Map<Node, Element[]>();
  const removedBy = new Map<Node, Element[]>();
  const removals: Array<{ node: Element; parent: Node; before: Node | null }> = [];
  for (const record of records) {
    // A node both removed and added in one update was moved (a reorder), not replaced.
    const incoming = elements(record.addedNodes).filter((node) => !removed.has(node) && node.isConnected);
    const outgoing = elements(record.removedNodes).filter((node) => !added.has(node));
    if (incoming.length) addedBy.set(record.target, [...(addedBy.get(record.target) ?? []), ...incoming]);
    if (outgoing.length) removedBy.set(record.target, [...(removedBy.get(record.target) ?? []), ...outgoing]);
    for (const node of outgoing) removals.push({ node, parent: record.target, before: record.nextSibling });
  }

  // AC4. A window swapped for another one in the same update is a step, not a close.
  const opensWindow = [...addedBy.values()].some((list) => list.some((node) => !node.hasAttribute("data-motion-ghost") && windowIn(node) !== null));
  if (!opensWindow) {
    for (const { node, parent, before } of removals) {
      if (parent.isConnected && windowIn(node)) playOut(node, parent, before);
    }
  }

  for (const [parent, incoming] of addedBy) {
    const outgoing = removedBy.get(parent) ?? [];
    const fresh = incoming.filter((node) => !node.hasAttribute("data-motion-ghost") && !node.hasAttribute("data-motion-saved"));
    if (fresh.length === 0) continue;
    // AC1
    if (outgoing.some(isPlaceholder) && !fresh.some(isPlaceholder)) {
      enter(fresh);
      continue;
    }
    // AC2
    const host = parent instanceof Element ? parent : null;
    const body = host?.tagName === "TBODY";
    if (!host || (!body && !host.hasAttribute("data-motion-list"))) continue;
    const rows = body ? fresh.filter((node) => node.tagName === "TR" && !isEmptyMarker(node)) : fresh;
    const gone = body ? outgoing.filter((node) => node.tagName === "TR") : outgoing;
    if (rows.length === fresh.length && isSoleAddition(rows.length, gone.length, gone.filter(isEmptyMarker).length)) rows.forEach(markNew);
  }
}

/** Starts everything above; returns the function that stops it. */
export function startPresence(): () => void {
  if (typeof MutationObserver === "undefined") return () => undefined;
  const observer = new MutationObserver(onTree);
  observer.observe(document.body, { childList: true, subtree: true });
  const passive = { capture: true, passive: true } as const;
  document.addEventListener("scroll", onScroll, passive);
  document.addEventListener("pointerdown", onTouch, passive);
  document.addEventListener("focusin", onTouch, passive);
  document.addEventListener("touchstart", onTouchStart, passive);
  document.addEventListener("touchmove", onTouchMove, passive);
  document.addEventListener("touchend", onTouchEnd, passive);
  document.addEventListener("touchcancel", onTouchEnd, passive);
  watchSaves();
  return () => {
    observer.disconnect();
    document.removeEventListener("scroll", onScroll, passive);
    document.removeEventListener("pointerdown", onTouch, passive);
    document.removeEventListener("focusin", onTouch, passive);
    document.removeEventListener("touchstart", onTouchStart, passive);
    document.removeEventListener("touchmove", onTouchMove, passive);
    document.removeEventListener("touchend", onTouchEnd, passive);
    document.removeEventListener("touchcancel", onTouchEnd, passive);
    unwatchSaves();
    lastCell = null;
    drag = null;
  };
}
