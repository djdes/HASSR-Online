import assert from "node:assert/strict";
import { test } from "node:test";

import { isMobileAppUserAgent, parseMobileAppUserAgent } from "@/lib/mobile-app";

import { appMarkerFromUserAgent, userAgentWithAppMarker } from "./app-marker";

const BROWSER = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36";
const APP = `${BROWSER} WeSetupApp/1.1.0 (android)`;

test("marker is taken from the app User-Agent only", () => {
  assert.equal(appMarkerFromUserAgent(APP), "1.1.0-android");
  assert.equal(appMarkerFromUserAgent(BROWSER), null);
});

test("a service worker request without the suffix is recognised by the cookie", () => {
  const restored = userAgentWithAppMarker(BROWSER, "1.1.0-android");
  assert.deepEqual(parseMobileAppUserAgent(restored), { platform: "android", version: "1.1.0" });
});

test("the real User-Agent wins and garbage in the cookie is ignored", () => {
  assert.equal(userAgentWithAppMarker(APP, "9.9.9-ios"), APP);
  assert.equal(userAgentWithAppMarker(BROWSER, "<script>"), BROWSER);
  assert.equal(userAgentWithAppMarker(BROWSER, "1.1.0-windows"), BROWSER);
  assert.equal(userAgentWithAppMarker(BROWSER, null), BROWSER);
  assert.equal(isMobileAppUserAgent(userAgentWithAppMarker(null, "2.0-ios")), true);
});
