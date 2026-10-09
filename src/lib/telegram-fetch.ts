import { fetch as undiciFetch, type Dispatcher } from "undici";
import { isStreamingBody } from "./streaming-body";

type CompatibleSignal = {
  aborted: boolean;
  reason?: unknown;
  addEventListener: (type: string, listener: () => void, options?: { once: boolean }) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

/** Adapt grammY's polyfill signal and streamed uploads to the scoped transport. */
export function createTelegramFetch(dispatcher?: Dispatcher) {
  return async (url: unknown, init: unknown) => {
    const opts = (init ?? {}) as { signal?: CompatibleSignal; body?: unknown };
    const forwarded: Record<string, unknown> = { ...((init as object | undefined) ?? {}) };
    let cleanup: (() => void) | undefined;
    if (opts.signal && !(opts.signal instanceof AbortSignal)) {
      const signal = opts.signal;
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      forwarded.signal = controller.signal;
      cleanup = () => signal.removeEventListener("abort", abort);
    }
    if (isStreamingBody(opts.body)) forwarded.duplex = "half";
    try {
      return await undiciFetch(
        url as Parameters<typeof undiciFetch>[0],
        { ...forwarded, ...(dispatcher ? { dispatcher } : {}) } as Parameters<typeof undiciFetch>[1]
      );
    } finally {
      cleanup?.();
    }
  };
}
