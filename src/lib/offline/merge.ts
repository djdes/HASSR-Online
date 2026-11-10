/**
 * Three-way merge of one journal row edited offline.
 *
 *   base   — values the device saw when the pack was downloaded
 *   mine   — what the person entered on the device
 *   theirs — what the journal holds right now (at sync time)
 *
 * A field changed only on the device is written; a field changed only on
 * the server stays; equal changes agree. A field changed differently on
 * both sides is a conflict: the journal keeps the server value and the
 * person decides ("Оставить как в журнале" / "Записать моё"). Nobody's
 * data is overwritten silently.
 */

export type OfflineFieldValue = string | number | boolean | null;
export type OfflineValues = Record<string, OfflineFieldValue | undefined>;

export type OfflineMergeConflict = { key: string; mine: OfflineFieldValue; theirs: OfflineFieldValue };

export type OfflineMergeResult = {
  /** Values to write: every key of `mine`, conflicts resolved to the server value. */
  merged: Record<string, OfflineFieldValue>;
  conflicts: OfflineMergeConflict[];
  /** Keys where the device value won (changed only on the device). */
  taken: string[];
  /** Keys where the server value was kept because only the server changed it. */
  kept: string[];
};

/** Empty string, null and undefined are the same "nothing"; numbers compare by value. */
export function normalizeOfflineValue(value: unknown): OfflineFieldValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  return String(value);
}

export function sameOfflineValue(a: unknown, b: unknown): boolean {
  const left = normalizeOfflineValue(a);
  const right = normalizeOfflineValue(b);
  if (left === right) return true;
  if (left === null || right === null) return false;
  // "4" typed into a number field equals 4 stored in the journal.
  if (typeof left !== "boolean" && typeof right !== "boolean") {
    const ln = Number(left);
    const rn = Number(right);
    if (!Number.isNaN(ln) && !Number.isNaN(rn) && String(left).trim() !== "" && String(right).trim() !== "") return ln === rn;
  }
  return String(left) === String(right);
}

export function mergeOfflineValues(input: {
  base: OfflineValues | null | undefined;
  mine: OfflineValues;
  theirs: OfflineValues | null | undefined;
  /** "Записать моё": the person looked at the conflict and chose the device value. */
  force?: boolean;
}): OfflineMergeResult {
  const base = input.base ?? {};
  const theirs = input.theirs ?? {};
  const merged: Record<string, OfflineFieldValue> = {};
  const conflicts: OfflineMergeConflict[] = [];
  const taken: string[] = [];
  const kept: string[] = [];

  for (const key of Object.keys(input.mine)) {
    const mine = normalizeOfflineValue(input.mine[key]);
    const their = normalizeOfflineValue(theirs[key]);
    const origin = normalizeOfflineValue(base[key]);
    const mineChanged = !sameOfflineValue(mine, origin);
    const theirsChanged = !sameOfflineValue(their, origin);

    if (sameOfflineValue(mine, their)) {
      merged[key] = mine;
    } else if (input.force || (mineChanged && !theirsChanged)) {
      merged[key] = mine;
      taken.push(key);
    } else if (!mineChanged && theirsChanged) {
      merged[key] = their;
      kept.push(key);
    } else {
      // Both sides changed it differently — or there was no base to compare with.
      merged[key] = their;
      conflicts.push({ key, mine, theirs: their });
    }
  }
  return { merged, conflicts, taken, kept };
}
