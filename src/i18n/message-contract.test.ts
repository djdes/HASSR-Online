import { test } from "node:test";
import { execFileSync } from "node:child_process";

test("message argument types are generated from the current source catalog", () => {
  execFileSync(process.execPath, ["scripts/i18n-types.mjs", "--check"], { stdio: "pipe" });
});
