/**
 * Photos of a queued offline record. The record body holds a marker where
 * a photo link must go; the photo itself waits in the queue item under the
 * same slot name. At delivery the photos are uploaded and the markers are
 * replaced with links. Pure.
 */
export const OFFLINE_PHOTO_MARK = "offline-photo:";

export const photoMark = (slot: string): string => `${OFFLINE_PHOTO_MARK}${slot}`;

function collect(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    for (const part of value.split(",")) if (part.startsWith(OFFLINE_PHOTO_MARK)) out.add(part.slice(OFFLINE_PHOTO_MARK.length));
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collect(item, out);
  }
}

/** Slots the record body refers to, in a stable order. */
export function photoSlotsOf(body: unknown): string[] {
  const out = new Set<string>();
  collect(body, out);
  return [...out].sort();
}

/** Body with every marker replaced by its uploaded link (markers without a link stay — the caller must not send those). */
export function withPhotoLinks<T>(body: T, links: Record<string, string>): T {
  const swap = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (!value.includes(OFFLINE_PHOTO_MARK)) return value;
      return value
        .split(",")
        .map((part) => (part.startsWith(OFFLINE_PHOTO_MARK) ? (links[part.slice(OFFLINE_PHOTO_MARK.length)] ?? part) : part))
        .join(",");
    }
    if (Array.isArray(value)) return value.map(swap);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, swap(item)]));
    return value;
  };
  return swap(body) as T;
}
