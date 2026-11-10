import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReverseImportGraph,
  evaluateTapAgainstBaseline,
  getColocatedTestCandidates,
  parseImportsFromSource,
  resolveImportTarget,
  resolveSelectionPlan,
} from "../../../scripts/test-changed.mjs";

test("parseImportsFromSource extracts @/, relative, and readFileSync src/ paths", () => {
  const code = `
    import { foo } from "@/lib/foo";
    import bar from "./bar";
    export { baz } from "../baz.server";
    const dyn = await import("@/components/widget");
    const req = require("./legacy");
    const raw = readFileSync(path.join(process.cwd(), "src/app/login/page.tsx"), "utf8");
  `;
  const nonTestSpecs = parseImportsFromSource(code, false);
  assert.deepEqual(nonTestSpecs.sort(), [
    "../baz.server",
    "./bar",
    "./legacy",
    "@/components/widget",
    "@/lib/foo",
  ]);

  const testSpecs = parseImportsFromSource(code, true);
  assert.ok(testSpecs.includes("src/app/login/page.tsx"));
});

test("resolveImportTarget resolves @/ alias, relative paths, extensions, and index files", () => {
  const files = new Set([
    "src/lib/foo.ts",
    "src/lib/crm/index.ts",
    "src/components/card.tsx",
    "src/app/login/page.tsx",
  ]);

  assert.equal(resolveImportTarget("src/app/login/page.tsx", "@/lib/foo", files), "src/lib/foo.ts");
  assert.equal(
    resolveImportTarget("src/app/login/page.tsx", "@/lib/crm", files),
    "src/lib/crm/index.ts",
  );
  assert.equal(
    resolveImportTarget("src/components/list.tsx", "./card", files),
    "src/components/card.tsx",
  );
  assert.equal(
    resolveImportTarget("src/lib/foo.test.ts", "src/app/login/page.tsx", files),
    "src/app/login/page.tsx",
  );
});

test("getColocatedTestCandidates handles standard, .server, and .client files", () => {
  assert.deepEqual(getColocatedTestCandidates("src/lib/foo.ts"), [
    "src/lib/foo.test.ts",
    "src/lib/foo.test.tsx",
  ]);
  assert.deepEqual(getColocatedTestCandidates("src/lib/crm/telphin.server.ts"), [
    "src/lib/crm/telphin.server.test.ts",
    "src/lib/crm/telphin.server.test.tsx",
    "src/lib/crm/telphin.test.ts",
    "src/lib/crm/telphin.test.tsx",
  ]);
  assert.deepEqual(getColocatedTestCandidates("src/components/box.client.tsx"), [
    "src/components/box.client.test.ts",
    "src/components/box.client.test.tsx",
    "src/components/box.test.ts",
    "src/components/box.test.tsx",
  ]);
});

test("resolveSelectionPlan selects co-located, .server sibling, and 1-hop reverse importer tests", () => {
  const virtualFiles = {
    "src/lib/alpha.ts": `export const a = 1;`,
    "src/lib/alpha.test.ts": `import { a } from "./alpha";`,
    "src/lib/beta.server.ts": `import { a } from "@/lib/alpha"; export const b = a + 1;`,
    "src/lib/beta.test.ts": `import { b } from "./beta.server";`,
    "src/app/api/items/route.ts": `import { b } from "@/lib/beta.server";`,
    "src/app/api/items/items-route.test.ts": `import { a } from "@/lib/alpha";`,
    "src/lib/unrelated.ts": `export const u = 0;`,
    "src/lib/unrelated.test.ts": `import { u } from "./unrelated";`,
  };
  const allSrcFiles = Object.keys(virtualFiles);
  const readSourceFn = (f: string) => virtualFiles[f as keyof typeof virtualFiles] || "";

  const plan = resolveSelectionPlan({
    changedFiles: ["src/lib/alpha.ts"],
    allSrcFiles,
    readSourceFn,
  });

  assert.equal(plan.mode, "changed");
  assert.deepEqual(plan.testFiles, [
    "src/app/api/items/items-route.test.ts",
    "src/lib/alpha.test.ts",
    "src/lib/beta.test.ts",
  ]);
});

test("resolveSelectionPlan escalates to full when core files, [full-tests], or >maxChangedCodeFiles touched", () => {
  const allSrcFiles = ["src/lib/a.ts", "src/lib/a.test.ts"];
  const readSourceFn = () => "";

  const corePlan = resolveSelectionPlan({
    changedFiles: ["prisma/schema.prisma", "src/lib/a.ts"],
    allSrcFiles,
    readSourceFn,
  });
  assert.equal(corePlan.mode, "full");
  assert.match(corePlan.reason, /prisma\/schema\.prisma/);

  const tagPlan = resolveSelectionPlan({
    changedFiles: ["src/lib/a.ts"],
    allSrcFiles,
    readSourceFn,
    commitMessage: "fix: check everything [full-tests]",
  });
  assert.equal(tagPlan.mode, "full");

  const manyFiles = Array.from({ length: 26 }, (_, i) => `src/lib/f${i}.ts`);
  const thresholdPlan = resolveSelectionPlan({
    changedFiles: manyFiles,
    allSrcFiles,
    readSourceFn,
    maxChangedCodeFiles: 25,
  });
  assert.equal(thresholdPlan.mode, "full");
});

test("resolveSelectionPlan returns mode=none when changed files have no related unit tests", () => {
  const allSrcFiles = ["src/lib/a.ts", "src/lib/a.test.ts"];
  const plan = resolveSelectionPlan({
    changedFiles: ["docs/README.md"],
    allSrcFiles,
    readSourceFn: () => "",
  });
  assert.equal(plan.mode, "none");
  assert.deepEqual(plan.testFiles, []);
});

test("evaluateTapAgainstBaseline allows legacy baseline failures and rejects new regressions", () => {
  const baseline = "# comment\nlegacy failing test\n";

  const allPass = evaluateTapAgainstBaseline(
    "TAP version 13\nok 1 - good test\n# pass 1\n# fail 0\n",
    baseline,
  );
  assert.equal(allPass.ok, true);
  assert.equal(allPass.passCount, 1);

  const onlyLegacy = evaluateTapAgainstBaseline(
    "TAP version 13\nok 1 - good test\nnot ok 2 - legacy failing test\n# pass 1\n# fail 1\n",
    baseline,
  );
  assert.equal(onlyLegacy.ok, true);
  assert.deepEqual(onlyLegacy.newFails, []);

  const newRegression = evaluateTapAgainstBaseline(
    "TAP version 13\nnot ok 1 - brand new failure\n# pass 0\n# fail 1\n",
    baseline,
  );
  assert.equal(newRegression.ok, false);
  assert.deepEqual(newRegression.newFails, ["brand new failure"]);
});
