// Паспорт выпуска: какие файлы собраны, из какого коммита, их размеры и
// SHA-256. Пишется рядом со сборкой и уходит в артефакты workflow «Выпуск
// приложений» — по нему видно, что в магазин загружен именно проверенный файл.
// Запускается ТОЛЬКО после проверки подписей (см. mobile-release.yml).
//
// Запуск: node scripts/release-manifest.mjs android|ios
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { APP_ID, mobileRoot, checkRelease } from "./release-preflight.mjs";

const platform = process.argv[2];
const errors = checkRelease({ platform });
if (errors.length) throw new Error(`Выпуск остановлен:\n${errors.join("\n")}`);

const relative =
  platform === "android"
    ? ["android/app/build/outputs/bundle/release/app-release.aab", "android/app/build/outputs/apk/release/app-release.apk"]
    : ["ios/App/build/WeSetup.ipa"];
const artifacts = relative.map((name) => {
  const file = path.join(mobileRoot, name);
  if (!existsSync(file)) throw new Error(`Нет файла сборки ${name}`);
  const bytes = readFileSync(file);
  return { file: path.basename(file), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
});

const server = process.env.GITHUB_SERVER_URL;
const repo = process.env.GITHUB_REPOSITORY;
const runId = process.env.GITHUB_RUN_ID;
const manifest = {
  platform,
  applicationId: APP_ID,
  version: JSON.parse(readFileSync(path.join(mobileRoot, "package.json"), "utf8")).version,
  buildNumber: Number(process.env.BUILD_NUMBER),
  sourceCommit:
    process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: mobileRoot, encoding: "utf8" }).trim(),
  workflowRun: server && repo && runId ? `${server}/${repo}/actions/runs/${runId}` : null,
  builtAt: new Date().toISOString(),
  verification: "Подписи проверены в workflow до записи паспорта. Перед отправкой на проверку — пройти список на телефоне (docs/mobile/09-release.md, шаг 4).",
  artifacts,
};
const output = path.join(
  mobileRoot,
  platform === "android" ? "android/app/build/outputs/release-manifest.json" : "ios/App/build/release-manifest.json",
);
writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
console.log(output);
