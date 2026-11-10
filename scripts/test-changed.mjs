#!/usr/bin/env node
// Smart targeted test runner (`test:changed`).
//
// Inspects changed files (via git diff) and builds a reverse dependency graph
// across `src/**/*.{ts,tsx}` up to 2 hops (plus direct co-located `*.test.ts`,
// `.server`/`.client` sibling tests, and explicit `"src/..."` path references
// inside test files) to run ONLY the affected unit tests.
//
// Automatically escalates to the full test suite (`mode = "full"`) when:
// - `--full` flag or `TEST_FULL=1` env var is set
// - commit message contains `[full-tests]` or `[all-tests]`
// - core/infrastructure files are modified (`package.json`, `prisma/schema.prisma`,
//   `src/lib/db.ts`, `src/lib/auth.ts`, `tsconfig*.json`, etc.)
// - more than `TEST_CHANGED_MAX_FILES` (default: 25) code files are modified

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_MAX_CHANGED_CODE_FILES = 25;
export const DEFAULT_MAX_TARGETED_TEST_FILES = 80;

export const CORE_FULL_SUITE_FILES = new Set([
  "package-lock.json",
  "prisma/schema.prisma",
  "tsconfig.json",
  "tsconfig.typecheck.json",
  "tests/.legacy-failures.txt",
  "src/lib/db.ts",
  "src/lib/auth.ts",
  "src/lib/auth-helpers.ts",
  "src/lib/permissions.ts",
  "src/lib/user-roles.ts",
  "src/lib/journal-acl.ts",
]);

/**
 * Explicit mapping for repository scripts / non-src files that have dedicated unit tests.
 */
export const EXPLICIT_FILE_TEST_MAP = {
  "scripts/test-changed.mjs": ["src/lib/ci/test-changed.test.ts"],
  "scripts/test-with-baseline.sh": ["src/lib/ci/test-changed.test.ts"],
  "scripts/verify-before-push.sh": ["src/lib/ci/test-changed.test.ts"],
};

export function normalizeRepoPath(p) {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/**
 * Extracts module specifiers from import/export/require statements and explicit
 * `"src/..."` file references (used by source-inspection tests).
 */
export function parseImportsFromSource(sourceText, isTestFile = false) {
  const specifiers = new Set();

  // Static import/export from "..." and dynamic import("...") / require("...")
  const importRegex =
    /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["']([^"'\r\n]+)["']/g;
  let match;
  while ((match = importRegex.exec(sourceText)) !== null) {
    const spec = match[1].trim();
    if (
      spec.startsWith("@/") ||
      spec.startsWith("./") ||
      spec.startsWith("../") ||
      spec.startsWith("src/")
    ) {
      specifiers.add(spec);
    }
  }

  // Many tests inspect source files via readFileSync/readFile/path.join(..., "src/...")
  if (isTestFile) {
    const srcPathRegex =
      /(?:readFileSync|readFile|join|resolve)\s*\([^\r\n;]*?["'`](src\/[A-Za-z0-9_./[\]()-]+?\.[A-Za-z0-9]+)["'`]/g;
    while ((match = srcPathRegex.exec(sourceText)) !== null) {
      specifiers.add(match[1].trim());
    }
  }

  return Array.from(specifiers);
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"];

/**
 * Resolves a specifier (`@/lib/foo`, `./bar`, `src/app/page.tsx`) relative to
 * `importerRepoPath` against a Set of known repo files (`allFilesSet`).
 */
export function resolveImportTarget(importerRepoPath, specifier, allFilesSet) {
  let candidateBase;
  if (specifier.startsWith("@/")) {
    candidateBase = "src/" + specifier.slice(2);
  } else if (specifier.startsWith("src/")) {
    candidateBase = specifier;
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const importerDir = path.posix.dirname(normalizeRepoPath(importerRepoPath));
    candidateBase = path.posix.normalize(path.posix.join(importerDir, specifier));
  } else {
    return null;
  }

  candidateBase = normalizeRepoPath(candidateBase);

  if (allFilesSet.has(candidateBase)) {
    return candidateBase;
  }

  // Strip extension if someone imported `./foo.js` for `./foo.ts`
  const ext = path.posix.extname(candidateBase);
  if (ext === ".js" || ext === ".mjs") {
    const stem = candidateBase.slice(0, -ext.length);
    for (const tryExt of [".ts", ".tsx"]) {
      if (allFilesSet.has(stem + tryExt)) {
        return stem + tryExt;
      }
    }
  }

  for (const tryExt of SOURCE_EXTENSIONS) {
    if (allFilesSet.has(candidateBase + tryExt)) {
      return candidateBase + tryExt;
    }
  }

  for (const tryExt of SOURCE_EXTENSIONS) {
    const indexCandidate = `${candidateBase}/index${tryExt}`;
    if (allFilesSet.has(indexCandidate)) {
      return indexCandidate;
    }
  }

  return null;
}

/**
 * Walks a directory recursively and returns normalized repo-relative paths.
 */
export function walkSrcFiles(rootDir, subDir = "src") {
  const results = [];
  const absStart = path.join(rootDir, subDir);
  if (!existsSync(absStart)) return results;

  const stack = [absStart];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && /\.(ts|tsx|js|mjs|json)$/.test(entry.name)) {
        results.push(normalizeRepoPath(path.relative(rootDir, fullPath)));
      }
    }
  }
  return results.sort();
}

/**
 * Builds a reverse dependency map: `targetFile -> Set<importerFile>`.
 */
export function buildReverseImportGraph(allFiles, readSourceFn) {
  const allFilesSet = new Set(allFiles);
  const reverseDeps = new Map();

  for (const file of allFiles) {
    if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue;
    let content;
    try {
      content = readSourceFn(file);
    } catch {
      continue;
    }
    const isTest = file.endsWith(".test.ts") || file.endsWith(".test.tsx");
    const specs = parseImportsFromSource(content, isTest);
    for (const spec of specs) {
      const target = resolveImportTarget(file, spec, allFilesSet);
      if (target && target !== file) {
        let set = reverseDeps.get(target);
        if (!set) {
          set = new Set();
          reverseDeps.set(target, set);
        }
        set.add(file);
      }
    }
  }

  return reverseDeps;
}

/**
 * Given a changed file path, returns candidate co-located test paths.
 * Handles:
 * - `src/a/foo.ts` -> `src/a/foo.test.ts`
 * - `src/a/foo.server.ts` -> `src/a/foo.test.ts` and `src/a/foo.server.test.ts`
 * - `src/a/foo.client.tsx` -> `src/a/foo.test.ts` and `src/a/foo.client.test.ts`
 */
export function getColocatedTestCandidates(changedFile) {
  const norm = normalizeRepoPath(changedFile);
  if (norm.endsWith(".test.ts") || norm.endsWith(".test.tsx")) {
    return [norm];
  }

  const ext = path.posix.extname(norm);
  if (!ext) return [];
  const withoutExt = norm.slice(0, -ext.length);
  const candidates = [`${withoutExt}.test.ts`, `${withoutExt}.test.tsx`];

  if (withoutExt.endsWith(".server")) {
    const base = withoutExt.slice(0, -".server".length);
    candidates.push(`${base}.test.ts`, `${base}.test.tsx`);
  } else if (withoutExt.endsWith(".client")) {
    const base = withoutExt.slice(0, -".client".length);
    candidates.push(`${base}.test.ts`, `${base}.test.tsx`);
  }

  return candidates;
}

/**
 * Computes the test execution plan (`full` | `changed` | `none`) from a list of changed files.
 */
export function resolveSelectionPlan({
  changedFiles,
  allSrcFiles,
  readSourceFn,
  forceFull = false,
  allowFullEscalation = true,
  commitMessage = "",
  maxChangedCodeFiles = DEFAULT_MAX_CHANGED_CODE_FILES,
  maxTargetedTestFiles = DEFAULT_MAX_TARGETED_TEST_FILES,
}) {
  const normalizedChanged = Array.from(
    new Set(changedFiles.map(normalizeRepoPath).filter(Boolean))
  );

  if (forceFull) {
    return {
      mode: "full",
      reason: "Принудительный полный прогон (--full / TEST_FULL=1)",
      changedFiles: normalizedChanged,
      testFiles: [],
    };
  }

  if (allowFullEscalation && /\[(full-tests|all-tests)\]/i.test(commitMessage)) {
    return {
      mode: "full",
      reason: "Метка [full-tests] в сообщении коммита",
      changedFiles: normalizedChanged,
      testFiles: [],
    };
  }

  if (normalizedChanged.length === 0) {
    return {
      mode: "none",
      reason: "Нет изменённых файлов",
      changedFiles: [],
      testFiles: [],
    };
  }

  if (allowFullEscalation) {
    for (const file of normalizedChanged) {
      if (CORE_FULL_SUITE_FILES.has(file)) {
        return {
          mode: "full",
          reason: `Затронут ядровый файл (${file})`,
          changedFiles: normalizedChanged,
          testFiles: [],
        };
      }
    }
  }

  const changedCodeFiles = normalizedChanged.filter(
    (f) =>
      (f.startsWith("src/") || f.startsWith("prisma/") || f.startsWith("scripts/")) &&
      /\.(ts|tsx|js|mjs|cjs|json)$/.test(f) &&
      !f.endsWith(".test.ts") &&
      !f.endsWith(".test.tsx")
  );

  if (allowFullEscalation && changedCodeFiles.length > maxChangedCodeFiles) {
    return {
      mode: "full",
      reason: `Изменено ${changedCodeFiles.length} файлов кода (порог ${maxChangedCodeFiles})`,
      changedFiles: normalizedChanged,
      testFiles: [],
    };
  }

  const allFilesSet = new Set(allSrcFiles);
  const selectedTests = new Set();

  // 1. Explicit non-src mappings
  for (const file of normalizedChanged) {
    const mapped = EXPLICIT_FILE_TEST_MAP[file];
    if (mapped) {
      for (const t of mapped) {
        if (allFilesSet.has(t)) selectedTests.add(t);
      }
    }
    // i18n messages or scripts -> run i18n tests
    if (file.startsWith("src/i18n/") || file === "scripts/i18n-types.mjs") {
      for (const srcFile of allSrcFiles) {
        if (srcFile.startsWith("src/i18n/") && srcFile.endsWith(".test.ts")) {
          selectedTests.add(srcFile);
        }
      }
    }
  }

  // 2. Direct co-located and `.server` / `.client` sibling tests
  const srcChanged = normalizedChanged.filter((f) => f.startsWith("src/"));
  for (const file of srcChanged) {
    for (const candidate of getColocatedTestCandidates(file)) {
      if (allFilesSet.has(candidate)) {
        selectedTests.add(candidate);
      }
    }
  }

  // 3. Reverse import graph traversal (1 hop: direct test importers + co-located tests of direct module importers)
  if (srcChanged.length > 0) {
    const reverseDeps = buildReverseImportGraph(allSrcFiles, readSourceFn);
    for (const node of srcChanged) {
      const importers = reverseDeps.get(node);
      if (!importers) continue;
      for (const importer of importers) {
        if (importer.endsWith(".test.ts") || importer.endsWith(".test.tsx")) {
          selectedTests.add(importer);
        } else {
          // Check if the direct importer module has a co-located test
          for (const candidate of getColocatedTestCandidates(importer)) {
            if (allFilesSet.has(candidate)) {
              selectedTests.add(candidate);
            }
          }
        }
      }
    }
  }

  const testFiles = Array.from(selectedTests).sort();

  if (testFiles.length > maxTargetedTestFiles) {
    return {
      mode: "full",
      reason: `Найдено ${testFiles.length} связанных тестовых файлов (порог ${maxTargetedTestFiles})`,
      changedFiles: normalizedChanged,
      testFiles: [],
    };
  }

  if (testFiles.length === 0) {
    return {
      mode: "none",
      reason: `Среди ${normalizedChanged.length} изменённых файлов нет связанных unit-тестов`,
      changedFiles: normalizedChanged,
      testFiles: [],
    };
  }

  return {
    mode: "changed",
    reason: `Отобрано ${testFiles.length} связанных тестовых файлов для ${normalizedChanged.length} изменённых файлов`,
    changedFiles: normalizedChanged,
    testFiles,
  };
}

function runGit(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function refExists(ref, cwd) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], {
      cwd,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects changed files in the current workspace or CI environment.
 */
export function detectChangedFiles(cwd, options = {}) {
  if (options.stagedOnly) {
    return runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR"], cwd);
  }

  const explicitRange = options.range || process.env.TEST_DIFF_RANGE;
  if (explicitRange) {
    return runGit(["diff", "--name-only", "--diff-filter=ACMR", explicitRange], cwd);
  }

  // GitHub Actions push event
  const ghBefore = process.env.GITHUB_EVENT_BEFORE;
  const ghSha = process.env.GITHUB_SHA;
  if (
    process.env.GITHUB_ACTIONS === "true" &&
    ghBefore &&
    ghSha &&
    !/^0+$/.test(ghBefore) &&
    refExists(ghBefore, cwd)
  ) {
    return runGit(["diff", "--name-only", "--diff-filter=ACMR", `${ghBefore}..${ghSha}`], cwd);
  }

  // Local workspace: combine branch diff vs origin/master + staged + unstaged + untracked in src/
  const files = new Set();
  for (const f of runGit(["diff", "--name-only", "--diff-filter=ACMR"], cwd)) files.add(f);
  for (const f of runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR"], cwd)) {
    files.add(f);
  }
  for (const f of runGit(["ls-files", "--others", "--exclude-standard", "src", "scripts"], cwd)) {
    files.add(f);
  }

  if (refExists("origin/master", cwd)) {
    const branchDiff = runGit(
      ["diff", "--name-only", "--diff-filter=ACMR", "origin/master...HEAD"],
      cwd
    );
    for (const f of branchDiff) files.add(f);
  }

  // If on master with clean working tree, inspect the latest commit HEAD~1..HEAD
  if (files.size === 0 && refExists("HEAD~1", cwd)) {
    for (const f of runGit(["diff", "--name-only", "--diff-filter=ACMR", "HEAD~1..HEAD"], cwd)) {
      files.add(f);
    }
  }

  return Array.from(files);
}

/**
 * Evaluates TAP output against `tests/.legacy-failures.txt`.
 */
export function evaluateTapAgainstBaseline(tapOutput, baselineContent) {
  const lines = tapOutput.split(/\r?\n/);
  const actualFailsSet = new Set();
  let passCount = null;
  let failCount = null;

  for (const line of lines) {
    const notOkMatch = /^not ok \d+ - (.+)$/.exec(line);
    if (notOkMatch) {
      actualFailsSet.add(notOkMatch[1].trim());
    }
    const passMatch = /^# pass (\d+)/.exec(line);
    if (passMatch) {
      passCount = Number(passMatch[1]);
    }
    const failMatch = /^# fail (\d+)/.exec(line);
    if (failMatch) {
      failCount = Number(failMatch[1]);
    }
  }

  if (passCount === null || failCount === null) {
    return {
      ok: false,
      error: "Не удалось извлечь статистику (# pass / # fail) из вывода TAP",
      passCount: 0,
      failCount: 0,
      newFails: [],
    };
  }

  if (failCount === 0) {
    return { ok: true, passCount, failCount: 0, newFails: [] };
  }

  const baselineSet = new Set(
    baselineContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  );

  const newFails = Array.from(actualFailsSet)
    .filter((f) => !baselineSet.has(f))
    .sort();

  return {
    ok: newFails.length === 0,
    passCount,
    failCount,
    newFails,
  };
}

function getHeadCommitMessage(cwd) {
  try {
    return execFileSync("git", ["log", "-1", "--pretty=%B"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function main() {
  const args = process.argv.slice(2);
  const cwd = process.cwd();

  const isList = args.includes("--list");
  const isJson = args.includes("--json");
  const isCiPlan = args.includes("--ci-plan");
  const stagedOnly = args.includes("--staged");
  const forceFull =
    args.includes("--full") ||
    process.env.TEST_FULL === "1" ||
    process.env.TEST_MODE === "full" ||
    process.env.GITHUB_EVENT_NAME === "workflow_dispatch";

  let range = null;
  const rangeIdx = args.indexOf("--range");
  if (rangeIdx !== -1 && args[rangeIdx + 1]) {
    range = args[rangeIdx + 1];
  }

  const maxChangedCodeFiles = Number(
    process.env.TEST_CHANGED_MAX_FILES || DEFAULT_MAX_CHANGED_CODE_FILES
  );
  const maxTargetedTestFiles = Number(
    process.env.TEST_CHANGED_MAX_TESTS || DEFAULT_MAX_TARGETED_TEST_FILES
  );

  const changedFiles = detectChangedFiles(cwd, { stagedOnly, range });
  const allSrcFiles = walkSrcFiles(cwd, "src");
  const commitMessage = getHeadCommitMessage(cwd);

  const plan = resolveSelectionPlan({
    changedFiles,
    allSrcFiles,
    readSourceFn: (relPath) => readFileSync(path.join(cwd, relPath), "utf8"),
    forceFull,
    allowFullEscalation: !stagedOnly,
    commitMessage,
    maxChangedCodeFiles,
    maxTargetedTestFiles,
  });

  if (isJson) {
    console.log(JSON.stringify(plan, null, 2));
    process.exit(0);
  }

  if (isList) {
    if (plan.mode === "full") {
      console.log("__FULL__");
    } else if (plan.mode === "changed") {
      for (const f of plan.testFiles) console.log(f);
    }
    process.exit(0);
  }

  if (isCiPlan) {
    console.log(`[test-changed] mode=${plan.mode} (${plan.reason})`);
    if (plan.changedFiles.length > 0) {
      console.log(`[test-changed] changed files (${plan.changedFiles.length}):`);
      for (const f of plan.changedFiles.slice(0, 30)) {
        console.log(`  - ${f}`);
      }
    }
    if (plan.testFiles.length > 0) {
      console.log(`[test-changed] selected tests (${plan.testFiles.length}):`);
      for (const f of plan.testFiles) {
        console.log(`  - ${f}`);
      }
    }
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `mode=${plan.mode}\ncount=${plan.testFiles.length}\n`,
        "utf8"
      );
    }
    process.exit(0);
  }

  // Execute tests according to the plan
  if (plan.mode === "none") {
    console.log(`✓ [test:changed] ${plan.reason} — запуск unit-тестов не требуется.`);
    process.exit(0);
  }

  if (plan.mode === "full") {
    console.log(`→ [test:changed] Эскалация до полного прогона: ${plan.reason}`);
    const res = spawnSync("bash", ["scripts/test-with-baseline.sh"], {
      cwd,
      stdio: "inherit",
      env: { ...process.env, TEST_FULL: "1" },
    });
    process.exit(res.status ?? 1);
  }

  console.log(`→ [test:changed] ${plan.reason}:`);
  for (const f of plan.testFiles) {
    console.log(`  • ${f}`);
  }

  const nodeArgs = ["--import", "tsx", "--test", "--test-reporter=tap"];
  if (process.env.TEST_CONCURRENCY) {
    nodeArgs.push(`--test-concurrency=${process.env.TEST_CONCURRENCY}`);
  }
  nodeArgs.push(...plan.testFiles);

  const startedAt = Date.now();
  const proc = spawnSync(process.execPath, nodeArgs, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const output = `${proc.stdout || ""}\n${proc.stderr || ""}`;

  const baselinePath = path.join(cwd, "tests/.legacy-failures.txt");
  const baselineContent = existsSync(baselinePath) ? readFileSync(baselinePath, "utf8") : "";
  const evalResult = evaluateTapAgainstBaseline(output, baselineContent);

  if (evalResult.error) {
    console.error(`✗ ${evalResult.error}`);
    console.error(output.split(/\r?\n/).slice(-30).join("\n"));
    process.exit(1);
  }

  console.log(
    `\n=== Targeted test stats (${plan.testFiles.length} files, ${elapsedSec}s): pass=${evalResult.passCount}, fail=${evalResult.failCount} ===`
  );

  if (!evalResult.ok) {
    console.error("\n✗ НОВЫЕ регрессии (нет в baseline):");
    for (const f of evalResult.newFails) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  }

  if (evalResult.failCount > 0) {
    console.log(`✓ ${evalResult.failCount} fails — все в baseline (legacy). Регрессий нет.`);
  } else {
    console.log("✓ Все затронутые тесты прошли.");
  }
  process.exit(0);
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main();
}
