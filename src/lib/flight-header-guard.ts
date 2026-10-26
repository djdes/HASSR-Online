import http, { type IncomingHttpHeaders } from "node:http";

/**
 * Next.js 16.1.6 reads its router headers on page requests too: a page
 * request with `Next-Router-Prefetch: 1` but without `RSC: 1` is rendered as
 * a prefetch. Segments below the first loading boundary are left out, the
 * server render of the HTML suspends on them forever (`layout-router` →
 * `use(unresolvedThenable)`), and the response never ends — anyone can hold
 * connections and renders open that way.
 *
 * The proxy cannot help: Next hides these headers from it and re-applies
 * them afterwards as "not overridable". So they are dropped here, on the
 * Node server, before Next sees the request — only on requests that are not
 * RSC requests, where they mean nothing. Real navigations and prefetches
 * (always `RSC: 1`) are left alone.
 */

const ROUTER_HEADERS = ["next-router-prefetch", "next-router-segment-prefetch", "next-router-state-tree"] as const;

/** Returns true when it dropped something. */
export function dropStrayRouterHeaders(req: { headers: IncomingHttpHeaders; url?: string }): boolean {
  if (req.headers.rsc === "1") return false;
  // `.rsc` paths carry the RSC mark in the URL; Next sets the header itself.
  if (req.url?.split("?")[0].endsWith(".rsc")) return false;
  let dropped = false;
  for (const name of ROUTER_HEADERS) {
    if (name in req.headers) {
      delete req.headers[name];
      dropped = true;
    }
  }
  return dropped;
}

const INSTALLED = Symbol.for("wesetup.flightHeaderGuard");

type GuardedPrototype = typeof http.Server.prototype & { [INSTALLED]?: boolean };

/**
 * Once per process (instrumentation.ts): every `http.Server` — the one
 * `next start` creates included — cleans a request before its listeners run.
 */
export function installFlightHeaderGuard(): void {
  const prototype = http.Server.prototype as GuardedPrototype;
  if (prototype[INSTALLED]) return;
  const emit = prototype.emit as (this: http.Server, event: string | symbol, ...args: unknown[]) => boolean;
  prototype.emit = function guardedEmit(this: http.Server, event: string | symbol, ...args: unknown[]) {
    if (event === "request") {
      try {
        dropStrayRouterHeaders(args[0] as http.IncomingMessage);
      } catch {
        // Never let the guard break a request.
      }
    }
    return emit.call(this, event, ...args);
  } as typeof prototype.emit;
  prototype[INSTALLED] = true;
}
