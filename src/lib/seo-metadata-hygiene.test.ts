import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const APP_DIR = path.join(process.cwd(), "src", "app");

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "api") continue;
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("SEO metadata hygiene", () => {
  it("no page metadata string title appends '— WeSetup' without { absolute }", () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(APP_DIR)) {
      const rel = path.relative(process.cwd(), file).replaceAll("\\", "/");
      const src = fs.readFileSync(file, "utf8");
      // Match `const TITLE = "... — WeSetup"` or `title: "... — WeSetup"` (not `absolute: "... — WeSetup"`).
      const directTitleMatches = [
        ...src.matchAll(/\bconst\s+TITLE\s*=\s*["'`]([^"'`]*—\s*WeSetup)["'`]/g),
        ...src.matchAll(/(?<!absolute\s*:\s*)\btitle\s*:\s*["'`]([^"'`]*—\s*WeSetup)["'`]/g),
      ];
      if (directTitleMatches.length > 0) {
        offenders.push(`${rel}: ${directTitleMatches.map((m) => m[1]).join("; ")}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Duplicate brand suffix in page title (root layout already applies '%s — WeSetup'):\n${offenders.join("\n")}`,
    );
  });

  it("/register sets noindex, follow like /login", () => {
    const registerPage = fs.readFileSync(
      path.join(APP_DIR, "(auth)", "register", "page.tsx"),
      "utf8",
    );
    assert.match(registerPage, /robots:\s*\{\s*index:\s*false,\s*follow:\s*true\s*\}/);
  });

  it("core public landing pages define canonical, openGraph, and twitter metadata", () => {
    for (const rel of [
      "sanpin-2-3-2-4-4282-26/page.tsx",
      "security/page.tsx",
      "avtozapolnenie/page.tsx",
      "status/page.tsx",
    ]) {
      const src = fs.readFileSync(path.join(APP_DIR, rel), "utf8");
      assert.match(src, /canonical:/, `${rel} missing canonical`);
      assert.match(src, /openGraph:\s*\{/, `${rel} missing openGraph`);
      assert.match(src, /twitter:\s*\{/, `${rel} missing twitter`);
    }
  });
});
