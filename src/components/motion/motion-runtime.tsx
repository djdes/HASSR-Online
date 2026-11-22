"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import {
  LOOK_PROPERTIES,
  SELECTION_ATTRIBUTES,
  boxInsets,
  classifyChange,
  flightDirection,
  isFarFlight,
  joinsLiquid,
  leadingEdgeNeedsSoftLanding,
  onOneTrack,
  pairSelections,
  planLiquid,
  type Box,
  type LiquidPlan,
  type Look,
} from "@/components/motion/motion-model";

/**
 * Motion that CSS alone cannot play, because it depends on the previous state (spec
 * `.agent/tasks/site-motion-2026-11-22`). Mounted once in the root layout; styles are in
 * `src/app/motion.css`.
 *
 * • Liquid selection (AC6): when one item of a group stops being chosen and another becomes
 *   chosen in the same update — tabs, segmented controls, navigation rows — the fill flows
 *   between them. The runtime only watches attributes (`aria-selected`, `aria-pressed`,
 *   `aria-current`, `data-state`, `data-active`); components are not changed. The shape is a
 *   pseudo-element of the group, the chosen item wears the idle look until the shape arrives.
 * • Toggle (AC4): the knob stretches on its way.
 * • Check box (AC5): `data-ticked` for the time the mark draws.
 * • Tab panel and page (AC8): the panel of a chosen tab arrives through a short blur; the page
 *   area fades in on a route change.
 *
 * «Без анимации» / «Reduce motion» (`data-view-still`, AC11): nothing here runs.
 */

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Longest liquid transition in `motion.css` (0.6 s + 0.04 s delay) and a frame of margin. */
const FLIGHT_MS = 700;
const KNOB_MS = 420;
const TICK_MS = 520;
const PANEL_MS = 420;
const PAGE_MS = 220;

const KNOB_SELECTOR =
  '[data-slot="switch-thumb"], span.rounded-full:empty:only-child, div.rounded-full:empty:only-child';

function motionOff(): boolean {
  if (document.documentElement.hasAttribute("data-view-still")) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

let springEasing: string | null = null;
/** The `--spring` token as a WAAPI easing (a browser without `linear()` has an ease-out in it). */
function spring(): string {
  if (springEasing === null) {
    springEasing = getComputedStyle(document.documentElement).getPropertyValue("--spring").trim() || "ease-out";
  }
  return springEasing;
}

function play(element: Element, frames: Keyframe[], options: KeyframeAnimationOptions): void {
  if (typeof element.animate !== "function") return;
  try {
    element.animate(frames, options);
  } catch {
    // An easing this engine does not know: play it plainly rather than not at all.
    try {
      element.animate(frames, { ...options, easing: "ease-out" });
    } catch {
      /* no animation */
    }
  }
}

function camelCase(property: string): string {
  return property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * The look the element is heading to. Right after a state change its colour transition has
 * only started and the computed style still shows the old colour — the end value is taken
 * from the running transition.
 */
function settledLook(element: HTMLElement): Look {
  const computed = getComputedStyle(element);
  const look: Look = {};
  for (const name of LOOK_PROPERTIES) look[name] = computed.getPropertyValue(name);
  const animations = typeof element.getAnimations === "function" ? element.getAnimations() : [];
  for (const animation of animations) {
    const property = (animation as Partial<CSSTransition>).transitionProperty;
    if (!property || !(property in look)) continue;
    const effect = animation.effect as KeyframeEffect | null;
    const frames = effect && typeof effect.getKeyframes === "function" ? effect.getKeyframes() : [];
    const value = (frames[frames.length - 1] as Record<string, unknown> | undefined)?.[camelCase(property)];
    if (typeof value === "string" && value) look[property] = value;
  }
  return look;
}

/**
 * Layout box of an item relative to the padding edge of the group — through `offset*`, not
 * `getBoundingClientRect`: a pressed item is still springing back from its squeeze, and the
 * shape must land on its real size.
 */
function layoutBox(element: HTMLElement, host: HTMLElement): Box | null {
  let x = 0;
  let y = 0;
  let node: HTMLElement = element;
  for (let guard = 0; guard < 12; guard += 1) {
    const parent = node.offsetParent as HTMLElement | null;
    if (!parent) return null;
    x += node.offsetLeft;
    y += node.offsetTop;
    if (parent === host) return { x, y, width: element.offsetWidth, height: element.offsetHeight };
    if (!host.contains(parent)) return null;
    x += parent.clientLeft - parent.scrollLeft;
    y += parent.clientTop - parent.scrollTop;
    node = parent;
  }
  return null;
}

type SavedStyle = Array<[name: string, value: string, priority: string]>;

function wear(element: HTMLElement, styles: Record<string, string>): SavedStyle {
  const saved: SavedStyle = [];
  for (const [name, value] of Object.entries(styles)) {
    saved.push([name, element.style.getPropertyValue(name), element.style.getPropertyPriority(name)]);
    element.style.setProperty(name, value, "important");
  }
  return saved;
}

function unwear(element: HTMLElement, saved: SavedStyle): void {
  for (const [name, value, priority] of saved) {
    if (value) element.style.setProperty(name, value, priority);
    else element.style.removeProperty(name);
  }
}

type Flight = {
  host: HTMLElement;
  target: HTMLElement;
  pseudo: "before" | "after";
  /** Inline styles of the group and the chosen item to put back when the shape lands. */
  hostSaved: SavedStyle;
  targetSaved: SavedStyle;
  timer: number;
};

const flights = new Map<HTMLElement, Flight>();

const SHAPE_ATTRIBUTES = ["data-liquid-host", "data-liquid-dir", "data-liquid-far", "data-liquid-phase"] as const;
const SHAPE_VARIABLES = [
  "--lq-l",
  "--lq-t",
  "--lq-r",
  "--lq-b",
  "--lq-lead",
  "--lq-bg",
  "--lq-bgi",
  "--lq-shadow",
  "--lq-bw",
  "--lq-bc",
  "--lq-radius",
] as const;

function freePseudo(host: HTMLElement): "before" | "after" | null {
  for (const pseudo of ["before", "after"] as const) {
    const content = getComputedStyle(host, `::${pseudo}`).content;
    if (content === "none" || content === "normal") return pseudo;
  }
  return null;
}

function setInsets(host: HTMLElement, box: Box): void {
  const insets = boxInsets(box, host.clientWidth, host.clientHeight);
  host.style.setProperty("--lq-l", `${insets.left}px`);
  host.style.setProperty("--lq-t", `${insets.top}px`);
  host.style.setProperty("--lq-r", `${insets.right}px`);
  host.style.setProperty("--lq-b", `${insets.bottom}px`);
}

/** The shape has arrived: it goes, the chosen item shows its own fill — in one frame. */
function land(flight: Flight): void {
  const { host, target } = flight;
  window.clearTimeout(flight.timer);
  flights.delete(host);
  const transition: SavedStyle = [
    ["transition", target.style.getPropertyValue("transition"), target.style.getPropertyPriority("transition")],
  ];
  target.style.setProperty("transition", "none", "important");
  unwear(target, flight.targetSaved);
  for (const attribute of SHAPE_ATTRIBUTES) host.removeAttribute(attribute);
  for (const name of SHAPE_VARIABLES) host.style.removeProperty(name);
  unwear(host, flight.hostSaved);
  // Apply the item's own fill while its transitions are off, then give them back.
  void getComputedStyle(target).backgroundColor;
  unwear(target, transition);
}

function fly(from: HTMLElement, to: HTMLElement, host: HTMLElement, plan: LiquidPlan): void {
  let flight = flights.get(host);
  const fresh = !flight;
  if (!flight) {
    const pseudo = freePseudo(host);
    if (!pseudo) return;
    const hostStyle = getComputedStyle(host);
    // A group without a box of its own cannot hold the shape: `display: contents`, an inline
    // element, a table part (a row does not become a containing block everywhere).
    if (/^(contents|inline|inline-table|table(-[a-z-]+)?)$/.test(hostStyle.display)) return;
    const hostStyles: Record<string, string> = {};
    if (hostStyle.position === "static") hostStyles.position = "relative";
    flight = { host, target: to, pseudo, hostSaved: wear(host, hostStyles), targetSaved: [], timer: 0 };
  } else {
    window.clearTimeout(flight.timer);
    // The item chosen a moment ago is idle now: its mask has nothing left to hide.
    unwear(flight.target, flight.targetSaved);
    flight.targetSaved = [];
    flight.target = to;
  }

  const fromBox = layoutBox(from, host);
  const toBox = layoutBox(to, host);
  // Nothing to fly to or from, or the pair is not in one row or column (cells of a grid).
  const flows = toBox && toBox.width > 0 && toBox.height > 0 && (fromBox ? onOneTrack(fromBox, toBox) : !fresh);
  if (!toBox || !flows) {
    if (fresh) unwear(host, flight.hostSaved);
    else land(flight);
    return;
  }

  for (const [name, value] of Object.entries(plan.shape)) host.style.setProperty(name, value);
  if (fresh && fromBox) {
    // Start under the item that was chosen, placed without a transition.
    setInsets(host, fromBox);
    host.setAttribute("data-liquid-phase", "set");
    host.setAttribute("data-liquid-host", flight.pseudo);
    void getComputedStyle(host, `::${flight.pseudo}`).left;
  }
  flight.targetSaved = wear(to, plan.mask);
  if (fromBox) {
    const direction = flightDirection(fromBox, toBox);
    host.setAttribute("data-liquid-dir", direction);
    host.toggleAttribute("data-liquid-far", isFarFlight(fromBox, toBox));
    // At the very edge of the group the leading edge lands without the overshoot.
    const snug = leadingEdgeNeedsSoftLanding(
      direction,
      boxInsets(fromBox, host.clientWidth, host.clientHeight),
      boxInsets(toBox, host.clientWidth, host.clientHeight),
    );
    if (snug) host.style.setProperty("--lq-lead", "var(--spring-soft)");
    else host.style.removeProperty("--lq-lead");
  }
  host.setAttribute("data-liquid-phase", "run");
  setInsets(host, toBox);
  const current = flight;
  flight.timer = window.setTimeout(() => land(current), FLIGHT_MS);
  flights.set(host, flight);
}

/** The knob of a toggle stretches towards where it goes: the leading edge runs ahead. */
function stretchKnob(control: HTMLElement): void {
  const knob = control.querySelector<HTMLElement>(KNOB_SELECTOR);
  // The landing's knob (`.motion-knob`) plays its own stretch.
  if (!knob || knob.classList.contains("motion-knob")) return;
  const on = control.getAttribute("aria-checked") === "true";
  const rtl = getComputedStyle(control).direction === "rtl";
  const origin = on !== rtl ? "left center" : "right center";
  const held = getComputedStyle(knob).scale;
  play(
    knob,
    [
      { scale: !held || held === "none" ? "1 1" : held, transformOrigin: origin },
      // Peak early and modest: with a 2 px inset (the `Switch` primitive) a longer stretch
      // would push the leading edge past the end of the track.
      { scale: "1.32 0.92", transformOrigin: origin, offset: 0.3 },
      { scale: "1 1", transformOrigin: origin },
    ],
    { duration: KNOB_MS, easing: "ease-out" },
  );
}

const ticking = new WeakMap<HTMLElement, number>();

function tick(box: HTMLElement): void {
  window.clearTimeout(ticking.get(box));
  box.setAttribute("data-ticked", "");
  ticking.set(
    box,
    window.setTimeout(() => box.removeAttribute("data-ticked"), TICK_MS),
  );
}

/** The panel of the chosen tab arrives through a short blur. */
function swapPanel(tab: HTMLElement): void {
  const id = tab.getAttribute("aria-controls");
  const panel = id ? document.getElementById(id) : null;
  if (!panel || panel.hidden) return;
  play(
    panel,
    [
      { opacity: 0, filter: "blur(6px)", translate: "0 0.35em" },
      { opacity: 1, filter: "blur(0px)", translate: "0 0" },
    ],
    { duration: PANEL_MS, easing: spring() },
  );
}

function onMutations(records: MutationRecord[]): void {
  if (motionOff()) return;
  const lost = new Set<HTMLElement>();
  const gained = new Set<HTMLElement>();
  // Several records for one attribute in one update: the first carries the value before it.
  const seen = new Map<HTMLElement, Set<string>>();
  for (const record of records) {
    const element = record.target;
    const attribute = record.attributeName;
    if (!attribute || !(element instanceof HTMLElement) || !element.isConnected) continue;
    let attributes = seen.get(element);
    if (!attributes) seen.set(element, (attributes = new Set()));
    if (attributes.has(attribute)) continue;
    attributes.add(attribute);
    const change = classifyChange(attribute, record.oldValue, element.getAttribute(attribute));
    if (!change) continue;
    const role = element.getAttribute("role");
    if (attribute === "aria-checked") {
      if (role === "switch") stretchKnob(element);
      else if ((role === "checkbox" || role === "menuitemcheckbox") && change === "gained") tick(element);
    }
    if (!joinsLiquid(attribute, role)) continue;
    (change === "gained" ? gained : lost).add(element);
  }
  if (gained.size === 0) return;

  for (const tab of gained) if (tab.getAttribute("role") === "tab") swapPanel(tab);
  if (lost.size === 0) return;

  // One group — one shape: a group where several pairs would show a flow (a list of chips
  // inverted at once) is left alone.
  const plans = new Map<HTMLElement, Array<{ from: HTMLElement; to: HTMLElement; plan: LiquidPlan }>>();
  for (const { from, to, host } of pairSelections([...lost], [...gained])) {
    if (to.closest('[data-liquid="off"]')) continue;
    const plan = planLiquid(settledLook(to), settledLook(from));
    if (!plan) continue;
    const list = plans.get(host);
    if (list) list.push({ from, to, plan });
    else plans.set(host, [{ from, to, plan }]);
  }
  for (const [host, list] of plans) {
    if (list.length === 1) fly(list[0].from, list[0].to, host, list[0].plan);
  }
}

export function MotionRuntime() {
  const pathname = usePathname();
  const previousPath = useRef<string | null>(null);

  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeOldValue: true,
      attributeFilter: [...SELECTION_ATTRIBUTES],
      subtree: true,
    });
    return () => {
      observer.disconnect();
      for (const flight of [...flights.values()]) land(flight);
    };
  }, []);

  // Page area of the cabinet (`data-page-area`, SectionFrame) fades in on a route change.
  // Opacity only: a transform or a filter on the page would move its fixed bars.
  useIsomorphicLayoutEffect(() => {
    const before = previousPath.current;
    previousPath.current = pathname;
    if (before === null || before === pathname || motionOff()) return;
    const area = document.querySelector("[data-page-area]");
    if (!area) return;
    for (const child of Array.from(area.children)) {
      play(child, [{ opacity: 0 }, { opacity: 1 }], { duration: PAGE_MS, easing: "ease-out" });
    }
  }, [pathname]);

  return null;
}
