import assert from "node:assert/strict";
import test from "node:test";

import { ANDROID_APK_URL } from "@/lib/app-links";

import { GET } from "./route";

test("/download/android перенаправляет на подписанный APK в выпуске GitHub", () => {
  const response = GET();
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), ANDROID_APK_URL);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
