import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { browserSentryEnabled, loadSentryBrowser, reportError } from "./sentry-lazy";

/**
 * Ленивый Sentry в браузере (спека cloud-testing-2026-11-21, AC5): вне браузера и вне wesetup.ru ничего
 * не грузится; сам клиент — отдельный чанк, а не часть первого экрана.
 */
describe("lazy browser Sentry", () => {
  it("does nothing outside the browser", () => {
    assert.equal(browserSentryEnabled(), false);
    assert.equal(loadSentryBrowser(), null);
    assert.doesNotThrow(() => reportError(new Error("x")));
  });

  it("the client is loaded with a dynamic import, never statically on the first screen", () => {
    const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
    assert.match(read("src/lib/sentry-lazy.ts"), /import\("\.\/sentry-browser"\)/);
    for (const file of ["src/instrumentation-client.ts", "src/lib/sentry-lazy.ts", "src/lib/report-client-error.ts"]) {
      assert.doesNotMatch(read(file), /from "@sentry\//, `${file} must not import a Sentry SDK statically`);
    }
  });
});
