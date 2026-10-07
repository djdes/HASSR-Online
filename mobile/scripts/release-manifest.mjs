import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { mobileRoot, checkRelease } from "./release-preflight.mjs";

const platform = process.argv[2];
const errors = checkRelease({ platform });
if (errors.length) throw new Error(errors.join("\n"));
const relative = platform === "android"
  ? ["android/app/build/outputs/bundle/release/app-release.aab", "android/app/build/outputs/apk/release/app-release.apk"]
  : ["ios/App/build/WeSetup.ipa"];
const artifacts = relative.map((name) => {
  const file = path.join(mobileRoot, name);
  if (!existsSync(file)) throw new Error(`Missing release artifact: ${name}`);
  const bytes = readFileSync(file);
  return { file: path.basename(file), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
});
const manifest = {
  platform, applicationId: "ru.wesetup.app",
  version: JSON.parse(readFileSync(path.join(mobileRoot, "package.json"), "utf8")).version,
  buildNumber: Number(process.env.BUILD_NUMBER),
  sourceCommit: process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: mobileRoot, encoding: "utf8" }).trim(),
  workflowRun: process.env.GITHUB_RUN_ID || null,
  builtAt: new Date().toISOString(),
  verification: "Generated only after signature checks in the release workflow; requires device smoke testing before submission.",
  artifacts,
};
const output = path.join(mobileRoot, platform === "android" ? "android/app/build/outputs/release-manifest.json" : "ios/App/build/release-manifest.json");
writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
console.log(output);

