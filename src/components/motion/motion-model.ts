/**
 * Pure part of the motion runtime (spec `.agent/tasks/site-motion-2026-11-22`, AC6): what an
 * attribute change means, which items form a «was chosen → is chosen» pair, where the liquid
 * shape goes. No DOM globals here — the runtime (`motion-runtime.tsx`) feeds it, tests call it.
 */

/** Attributes whose change can mean «this item is the chosen one now». */
export const SELECTION_ATTRIBUTES = [
  "aria-selected",
  "aria-pressed",
  "aria-current",
  "aria-checked",
  "data-state",
  "data-active",
] as const;

/** Is the item chosen, judging by one attribute value. */
export function isChosen(attribute: string, value: string | null): boolean {
  if (value === null) return false;
  // Radix: tabs are `active`, toggle-group items are `on`. `open` and `checked` are other things.
  if (attribute === "data-state") return value === "active" || value === "on";
  if (attribute === "aria-current" || attribute === "data-active") return value !== "false";
  return value === "true";
}

export type SelectionChange = "gained" | "lost" | null;

/** What one attribute mutation did to the item. */
export function classifyChange(attribute: string, before: string | null, after: string | null): SelectionChange {
  const was = isChosen(attribute, before);
  const is = isChosen(attribute, after);
  if (was === is) return null;
  return is ? "gained" : "lost";
}

/**
 * Whether a change of this attribute on an element with this role takes part in liquid selection.
 * A switch and a check box are handled on their own (knob, check mark); `aria-selected` counts
 * only on tabs — in lists and calendars it follows the keyboard.
 */
export function joinsLiquid(attribute: string, role: string | null): boolean {
  if (role === "switch" || role === "checkbox" || role === "menuitemcheckbox") return false;
  if (attribute === "aria-selected") return role === "tab";
  if (attribute === "aria-checked") return role === "radio" || role === "menuitemradio";
  return true;
}

/** The minimum of a tree node the pairing needs — an `Element` fits. */
export type TreeNode = { parentElement: TreeNode | null };

/** How many levels up from a node the shared container of a pair may be. */
export const MAX_GROUP_DEPTH = 6;

/** Levels from `node` up to `ancestor`; `null` when it is not an ancestor within `limit`. */
export function depthBelow(node: TreeNode, ancestor: TreeNode, limit: number): number | null {
  let current: TreeNode | null = node;
  for (let depth = 0; depth <= limit && current; depth += 1) {
    if (current === ancestor) return depth;
    current = current.parentElement;
  }
  return null;
}

export type Pair<T> = { from: T; to: T; host: T };

/**
 * Pairs every item that became chosen with the nearest item that stopped being chosen: the
 * nearest shared container wins, then the same depth below it (a menu row pairs with a menu
 * row, not with the header of a neighbouring section). An item is used once.
 */
export function pairSelections<T extends TreeNode>(lost: readonly T[], gained: readonly T[], limit = MAX_GROUP_DEPTH): Pair<T>[] {
  const used = new Set<T>();
  const pairs: Pair<T>[] = [];
  for (const to of gained) {
    let best: { from: T; host: T; up: number; skew: number } | null = null;
    let host: TreeNode | null = to.parentElement;
    for (let up = 1; up <= limit && host && !best; up += 1, host = host.parentElement) {
      for (const from of lost) {
        if (used.has(from) || from === to) continue;
        const down = depthBelow(from, host, limit);
        if (down === null || down === 0) continue;
        const skew = Math.abs(down - up);
        if (!best || skew < best.skew) best = { from, host: host as T, up, skew };
      }
    }
    if (best) {
      used.add(best.from);
      pairs.push({ from: best.from, to, host: best.host });
    }
  }
  return pairs;
}

/** A layout box relative to the padding edge of the group. */
export type Box = { x: number; y: number; width: number; height: number };

export type Insets = { left: number; top: number; right: number; bottom: number };

/** Insets of an absolutely positioned shape that covers `box` inside a group of this inner size. */
export function boxInsets(box: Box, hostWidth: number, hostHeight: number): Insets {
  return {
    left: box.x,
    top: box.y,
    right: hostWidth - box.x - box.width,
    bottom: hostHeight - box.y - box.height,
  };
}

export type FlightDirection = "left" | "right" | "up" | "down";

/** Which edge leads: the axis with the longer way between the centres. */
export function flightDirection(from: Box, to: Box): FlightDirection {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}

/**
 * Do the two items lie in one row or one column (they overlap by at least half across it)?
 * Only then the fill flows: between cells of a grid — a calendar, tabs wrapped onto another
 * line — a shape stretched over both axes would cover everything in between.
 */
export function onOneTrack(from: Box, to: Box): boolean {
  const overlap = (startA: number, sizeA: number, startB: number, sizeB: number) =>
    Math.max(0, Math.min(startA + sizeA, startB + sizeB) - Math.max(startA, startB));
  const sameRow = overlap(from.y, from.height, to.y, to.height) >= Math.min(from.height, to.height) / 2;
  const sameColumn = overlap(from.x, from.width, to.x, to.width) >= Math.min(from.width, to.width) / 2;
  return sameRow || sameColumn;
}

/** Overshoot of `--spring` (globals.css) as a share of the way, with a margin. */
export const SPRING_OVERSHOOT = 0.02;

/**
 * Would the leading edge, overshooting on `--spring`, cross the edge of the group? Then it
 * lands on the soft spring instead. `from` / `to` are insets of the shape before and after.
 */
export function leadingEdgeNeedsSoftLanding(direction: FlightDirection, from: Insets, to: Insets): boolean {
  const side = direction === "right" ? "right" : direction === "left" ? "left" : direction === "down" ? "bottom" : "top";
  const way = Math.abs(from[side] - to[side]);
  return to[side] - way * SPRING_OVERSHOOT < 0.5;
}

/** Past this distance between centres the shape travels as one piece, without the stretch. */
export const FAR_FLIGHT_PX = 320;

export function isFarFlight(from: Box, to: Box): boolean {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  return Math.hypot(dx, dy) > FAR_FLIGHT_PX;
}

/**
 * Alpha of a computed colour: `rgba(…, a)`, `rgb(… / a)`, `oklch(… / a)`, `color(srgb … / a)`,
 * `transparent`. Unknown notation counts as opaque — the cautious answer for «can a shape be
 * seen through this item».
 */
export function colorAlpha(color: string): number {
  const value = color.trim().toLowerCase();
  if (!value || value === "transparent") return 0;
  const slash = value.match(/\/\s*([\d.]+)(%?)\s*\)$/);
  if (slash) return clamp01(Number(slash[1]) / (slash[2] ? 100 : 1));
  const legacy = value.match(/^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)(%?)\s*\)$/);
  if (legacy) return clamp01(Number(legacy[1]) / (legacy[2] ? 100 : 1));
  return 1;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/** An idle item more opaque than this hides a shape lying under it: such groups are left alone. */
export const OPAQUE_IDLE_ALPHA = 0.35;

/** Longhands that make up the «chosen» look of an item. */
export const FILL_PROPERTIES = ["background-color", "background-image", "box-shadow"] as const;
export const BORDER_SIDES = ["top", "right", "bottom", "left"] as const;

export type Look = Record<string, string>;

/** Properties whose settled value differs between the chosen and the idle item. */
export function differingProperties(chosen: Look, idle: Look): string[] {
  const names = [...FILL_PROPERTIES, ...BORDER_SIDES.map((side) => `border-${side}-color`)];
  return names.filter((name) => (chosen[name] ?? "") !== (idle[name] ?? ""));
}

export type LiquidPlan = {
  /** CSS variables of the shape (`--lq-*`). */
  shape: Record<string, string>;
  /** What the chosen item wears while the shape is on its way: the idle look. */
  mask: Record<string, string>;
};

/**
 * What flows and what the chosen item hides meanwhile. `null` — nothing to show: the chosen
 * state lives elsewhere (text colour, a pseudo-element), or the idle items are opaque and would
 * cover the shape.
 */
export function planLiquid(chosen: Look, idle: Look): LiquidPlan | null {
  const differing = differingProperties(chosen, idle);
  if (differing.length === 0) return null;
  if (colorAlpha(idle["background-color"] ?? "") > OPAQUE_IDLE_ALPHA) return null;
  const sides = BORDER_SIDES.map((side) => ({
    width: chosen[`border-${side}-width`] ?? "0px",
    color: differing.includes(`border-${side}-color`) ? (chosen[`border-${side}-color`] ?? "transparent") : "transparent",
  }));
  const drawsBorder = sides.some((side) => side.color !== "transparent" && parseFloat(side.width) > 0);
  const fills = differing.some((name) => (FILL_PROPERTIES as readonly string[]).includes(name));
  if (!fills && !drawsBorder) return null;
  const shape: Record<string, string> = {
    "--lq-bg": differing.includes("background-color") ? (chosen["background-color"] ?? "transparent") : "transparent",
    "--lq-bgi": differing.includes("background-image") ? (chosen["background-image"] ?? "none") : "none",
    "--lq-shadow": differing.includes("box-shadow") ? (chosen["box-shadow"] ?? "none") : "none",
    "--lq-bw": sides.map((side) => side.width).join(" "),
    "--lq-bc": sides.map((side) => side.color).join(" "),
    "--lq-radius": ["top-left", "top-right", "bottom-right", "bottom-left"]
      .map((corner) => firstRadius(chosen[`border-${corner}-radius`]))
      .join(" "),
  };
  const mask: Record<string, string> = {};
  for (const name of differing) mask[name] = idle[name] ?? "initial";
  return { shape, mask };
}

/** `border-*-radius` may be `10px` or `10px 6px` (elliptical): the shorthand takes one length per corner. */
function firstRadius(value: string | undefined): string {
  return (value ?? "0px").trim().split(/\s+/)[0] || "0px";
}

/** Longhands read from an item to build a plan. */
export const LOOK_PROPERTIES: readonly string[] = [
  ...FILL_PROPERTIES,
  ...BORDER_SIDES.flatMap((side) => [`border-${side}-color`, `border-${side}-width`]),
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
];

/* ── Round 2 (spec `.agent/tasks/site-motion-round2-2026-11-22`) ─────────────────────────── */

/** Step between elements that appear one after another, and how many steps there are at most. */
export const ENTER_STEP_MS = 45;
export const ENTER_MAX_STEPS = 6;

/** Delays for `count` elements entering in sequence: 0, 45, 90 … capped at six steps. */
export function enterDelays(count: number, step = ENTER_STEP_MS, maxSteps = ENTER_MAX_STEPS): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => Math.min(index, maxSteps) * step);
}

/**
 * A row (or a list item) counts as newly added when it arrives alone into a body that keeps its
 * other rows: one or two rows in (a record and its detail row), none out — except the «no rows
 * yet» line it replaces. A bulk load, a filter change or a reorder moves several rows at once.
 */
export function isSoleAddition(added: number, removed: number, removedEmptyMarkers: number): boolean {
  return added >= 1 && added <= 2 && removed - removedEmptyMarkers === 0;
}

/**
 * Is this request a save of journal data? Any method that changes something, sent to the journal
 * API — the one signal all journal screens share (each of them calls `fetch` on its own).
 */
export function isJournalSave(method: string | undefined, url: string): boolean {
  const verb = (method || "GET").toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return false;
  let path = url;
  try {
    path = new URL(url, "http://local").pathname;
  } catch {
    /* a relative path that URL cannot parse is matched as it is */
  }
  return /^\/api\/(journal-documents|journals|journal-entries)(\/|$)/.test(path);
}

/** How far a sheet has to be pulled down to close, and the zone at its top that can be grabbed. */
export const SHEET_DISMISS_PX = 90;
export const SHEET_GRAB_ZONE_PX = 72;

/** A flick: this fast (px per ms) and at least this far, the sheet closes without being dragged all the way. */
export const SHEET_FLICK_VELOCITY = 0.6;
export const SHEET_FLICK_MIN_PX = 30;

/** Released here, does the sheet close? Far enough — or a quick flick down. */
export function sheetDragCloses(offset: number, velocity = 0): boolean {
  if (offset > SHEET_DISMISS_PX) return true;
  return velocity >= SHEET_FLICK_VELOCITY && offset >= SHEET_FLICK_MIN_PX;
}

/**
 * What the first real movement of a touch in the grab zone means. Down — the sheet is being
 * pulled and the page must not take the gesture. Sideways or up — it is not ours (a row of chips
 * scrolls sideways, a swipe up does nothing to a sheet), let the browser have it.
 */
export const SHEET_SLOP_PX = 2;

export function sheetGesture(dx: number, dy: number): "pull" | "release" | "undecided" {
  if (Math.abs(dx) < SHEET_SLOP_PX && Math.abs(dy) < SHEET_SLOP_PX) return "undecided";
  if (dy > 0 && dy >= Math.abs(dx)) return "pull";
  return "release";
}

/**
 * Speed of the pull, smoothed so that one jittery sample does not decide a flick. The first
 * sample is taken as it is: a quick flick may be only two or three events long.
 */
export function smoothVelocity(previous: number, sample: number, first: boolean): number {
  return first ? sample : previous * 0.4 + sample * 0.6;
}

/** The handle while the sheet is pulled: an arrow, and past the closing point an arrow in the accent. */
export function grabberState(offset: number): "" | "armed" {
  return offset > SHEET_DISMISS_PX ? "armed" : "";
}

/** A placeholder subtree: carries the shimmer and no real text (a screen-reader label at most). */
export const PLACEHOLDER_TEXT_LIMIT = 60;

export function looksLikePlaceholder(hasShimmer: boolean, textLength: number): boolean {
  return hasShimmer && textLength <= PLACEHOLDER_TEXT_LIMIT;
}
