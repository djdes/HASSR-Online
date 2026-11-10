/**
 * One journal row is merged by one request at a time.
 *
 * Merging an offline edit is read → compare → write. Two devices coming
 * online in the same instant would both read the old row and the later
 * write would silently drop the earlier one — exactly what the merge is
 * there to prevent. The lock makes the second request wait and merge with
 * what the first one wrote.
 *
 * In-process on purpose: the site runs as a single Node process. If it is
 * ever scaled to several, this has to become a database lock.
 */
const tails = new Map<string, Promise<void>>();

/** Resolves when the row is free; call the returned function to release it. */
export async function acquireRowLock(key: string): Promise<() => void> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  tails.set(key, tail);
  await previous;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Nobody queued behind us — forget the key so the map does not grow.
    if (tails.get(key) === tail) tails.delete(key);
    release();
  };
}

export function rowLockKey(documentId: string, rowKey: string, dateKey: string): string {
  return `${documentId}|${rowKey}|${dateKey}`;
}

/** For tests: how many rows are locked or waited for right now. */
export function activeRowLocks(): number {
  return tails.size;
}
