import { useCallback, useInsertionEffect, useRef } from "react";

/**
 * A function with a stable identity that always calls the latest `callback`.
 *
 * For handlers passed to memoized children (`memo`): an inline function is new
 * on every render and makes `memo` useless — on the staff page that re-rendered
 * a 3 600-cell timesheet on every click. Call the result from events and
 * effects only, never during render (it would see the previous render's
 * callback). React's own `useEffectEvent` can't be passed to children, hence
 * this.
 */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(callback);
  useInsertionEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
