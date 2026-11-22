/**
 * Segments — a single choice out of a few short options: sort order, a filter, a period, a tab
 * (spec site-motion-round2-2026-11-22, AC6). One soft track, idle items without a fill of their
 * own, the chosen one a light pill.
 *
 * Why not chips with a fill each: the chosen fill flows from the previous item to the new one
 * (`MotionRuntime`), and it can only flow under items that are see-through. Mark the chosen item
 * with `aria-current`, `aria-selected`, `aria-pressed` or `aria-checked` — the runtime watches
 * those. Multi-choice chips (weekdays, journals, points) are not segments.
 *
 * The track is the soft fill of the cabinet (`--app-veil`: a box that lies on another surface);
 * the pill is `--app-segment-pill` (white; in the dark theme lighter than the track), its text
 * the colour the existing segmented controls use, repainted by the dark theme and «Новая».
 */

/** The track that holds the items. Wraps onto a second line when the row does not fit. */
export const SEGMENT_TRACK_CLASS = "inline-flex max-w-full flex-wrap gap-1 rounded-2xl bg-[var(--app-veil)] p-1";

/** One item: geometry and focus. Add `SEGMENT_ON_CLASS` or `SEGMENT_OFF_CLASS`. */
export const SEGMENT_ITEM_CLASS =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/** The chosen item. */
export const SEGMENT_ON_CLASS = "bg-[var(--app-segment-pill,#ffffff)] text-[#3848c7] shadow-[0_1px_2px_rgba(11,16,36,0.06)]";

/** Every other item. */
export const SEGMENT_OFF_CLASS = "text-[#6f7282] hover:text-[#0b1024]";

/** Classes of an item by its state. */
export function segmentClass(active: boolean, extra = ""): string {
  return `${SEGMENT_ITEM_CLASS} ${active ? SEGMENT_ON_CLASS : SEGMENT_OFF_CLASS}${extra ? ` ${extra}` : ""}`;
}
