import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GET } from "@/app/api/setup-helper/version/route";
import { readSetupHelperRelease, SETUP_HELPER_APK } from "@/lib/setup-helper-release";

// Приложение ставит обновление, только если хеш скачанного APK совпал с
// манифестом. Разошлись файл и version.json — обновление не встанет ни у
// кого, поэтому выпуск проверяем здесь, до деплоя.
test("published APK matches its version manifest", async () => {
  const release = await readSetupHelperRelease();
  assert.ok(release, "resources/setup-helper/version.json отсутствует или испорчен — выпускайте через publishRelease");
  const apk = readFileSync(SETUP_HELPER_APK);
  assert.equal(apk.length, release.size, "размер APK не совпадает с version.json");
  assert.equal(createHash("sha256").update(apk).digest("hex"), release.sha256, "SHA-256 APK не совпадает с version.json");
  assert.equal(apk.subarray(0, 2).toString("latin1"), "PK", "APK — zip-архив");
});

test("version endpoint serves the manifest with an absolute, cache-busting download link", async () => {
  const before = process.env.NEXTAUTH_URL;
  try {
    process.env.NEXTAUTH_URL = "https://wesetup.ru";
    const res = await GET();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-cache");
    const body = (await res.json()) as Record<string, unknown>;
    const release = await readSetupHelperRelease();
    assert.ok(release);
    assert.equal(body.versionCode, release.versionCode);
    assert.equal(body.versionName, release.versionName);
    assert.equal(body.sha256, release.sha256);
    assert.equal(body.size, release.size);
    assert.equal(body.downloadUrl, `https://wesetup.ru/api/setup-helper/download?v=${release.versionCode}`);
  } finally {
    if (before === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = before;
  }
});
