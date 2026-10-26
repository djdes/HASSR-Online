import assert from "node:assert/strict";
import http, { type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { dropStrayRouterHeaders, installFlightHeaderGuard } from "./flight-header-guard";

const ROUTER = { "next-router-prefetch": "1", "next-router-segment-prefetch": "/_tree", "next-router-state-tree": "%5B%22%22%5D" };

test("a page request loses the router headers, everything else stays", () => {
  const headers: IncomingHttpHeaders = { ...ROUTER, accept: "text/html", cookie: "a=b" };
  assert.equal(dropStrayRouterHeaders({ headers, url: "/login?next=%2Fjournals" }), true);
  assert.deepEqual(headers, { accept: "text/html", cookie: "a=b" });
  assert.equal(dropStrayRouterHeaders({ headers: { accept: "text/html" }, url: "/login" }), false);
});

test("RSC requests keep their router headers: navigations and prefetches work as before", () => {
  for (const request of [
    { headers: { ...ROUTER, rsc: "1" }, url: "/journals?_rsc=abc" },
    { headers: { ...ROUTER }, url: "/journals.rsc" },
    { headers: { ...ROUTER }, url: "/journals.segments/_tree.segment.rsc?x=1" },
  ]) {
    const before = { ...request.headers };
    assert.equal(dropStrayRouterHeaders(request), false, request.url);
    assert.deepEqual(request.headers, before);
  }
  // Anything but exactly "1" is not an RSC request for Next either.
  const doubled: IncomingHttpHeaders = { ...ROUTER, rsc: "1, 1" };
  dropStrayRouterHeaders({ headers: doubled, url: "/login" });
  assert.equal(doubled["next-router-prefetch"], undefined);
});

async function serve(handler: (req: http.IncomingMessage) => void) {
  const server = http.createServer((req, res) => {
    handler(req);
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    get: (headers: Record<string, string>) => fetch(`http://127.0.0.1:${port}/login`, { headers }).then((response) => response.text()),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("the guard cleans requests on a real http.Server before its listeners, once", async () => {
  installFlightHeaderGuard();
  installFlightHeaderGuard();
  const seen: IncomingHttpHeaders[] = [];
  const server = await serve((req) => seen.push({ ...req.headers }));
  try {
    assert.equal(await server.get({ "next-router-prefetch": "1", accept: "text/html" }), "ok");
    assert.equal(await server.get({ "next-router-prefetch": "1", rsc: "1" }), "ok");
  } finally {
    await server.close();
  }
  assert.equal(seen[0]["next-router-prefetch"], undefined);
  assert.equal(seen[0].accept, "text/html");
  assert.equal(seen[1]["next-router-prefetch"], "1");
  assert.equal(seen[1].rsc, "1");
  // Installed once: the patched emit does not wrap itself.
  assert.equal(http.Server.prototype.emit.name, "guardedEmit");
  assert.notEqual(Object.getPrototypeOf(http.Server.prototype).emit.name, "guardedEmit");
});

test("other server events pass through untouched", async () => {
  installFlightHeaderGuard();
  const server = http.createServer();
  let listening = false;
  server.on("listening", () => (listening = true));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  assert.equal(listening, true);
});
