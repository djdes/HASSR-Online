// Статические проверки нативных проектов приложения (mobile/android, mobile/ios):
// ошибки в этих файлах не ловит ни TypeScript, ни сборка сайта, а проявляются
// они только на телефоне.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const MOBILE = path.join(process.cwd(), "mobile");
const read = (rel: string) => readFileSync(path.join(MOBILE, rel), "utf8");

/** Каталог, в который WeSetupWebChromeClient.createPhotoUri кладёт снимок. */
function photoDirKind(java: string): "external-files" | "cache" | "files" {
  const body = java.slice(java.indexOf("private Uri createPhotoUri"));
  const createCall = body.slice(0, body.indexOf("File.createTempFile"));
  if (/getExternalFilesDir\(/.test(createCall)) return "external-files";
  if (/getCacheDir\(/.test(createCall)) return "cache";
  return "files";
}

test("Android: каталог снимка с камеры объявлен в file_paths.xml (иначе FileProvider падает и камеры в выборе нет)", () => {
  const java = read("android/app/src/main/java/ru/wesetup/app/WeSetupWebChromeClient.java");
  const xml = read("android/app/src/main/res/xml/file_paths.xml");
  assert.ok(java.includes("private Uri createPhotoUri"), "createPhotoUri не найден");

  const kind = photoDirKind(java);
  if (kind === "external-files") {
    // getExternalFilesDir(DIRECTORY_PICTURES) → <external-files-path path="Pictures/"> или path="."
    const dirMatch = java.match(/getExternalFilesDir\(Environment\.DIRECTORY_(\w+)\)/);
    const sub = dirMatch ? dirMatch[1][0] + dirMatch[1].slice(1).toLowerCase() : "";
    const tags = [...xml.matchAll(/<external-files-path\b[^>]*path="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(
      tags.some((p) => p === "." || p === "" || p.replace(/\/$/, "") === sub),
      `file_paths.xml не объявляет external-files-path для ${sub}: ${tags.join(", ") || "нет"}`,
    );
  } else {
    const tag = kind === "cache" ? "cache-path" : "files-path";
    assert.match(xml, new RegExp(`<${tag}\b`), `file_paths.xml не объявляет ${tag}`);
  }

  // Запасной каталог (getCacheDir) тоже должен быть объявлен.
  if (/getCacheDir\(/.test(java.slice(java.indexOf("private Uri createPhotoUri")))) {
    assert.match(xml, /<cache-path\b/);
  }
});

test("iOS: ровно один путь запуска экрана — storyboard или окно из SceneDelegate", () => {
  const plist = read("ios/App/App/Info.plist");
  const scene = read("ios/App/App/SceneDelegate.swift");
  const storyboardKeys =
    /<key>UIMainStoryboardFile<\/key>/.test(plist) || /<key>UISceneStoryboardFile<\/key>/.test(plist);
  const codeWindow = /UIWindow\(windowScene:/.test(scene) || /rootViewController\s*=/.test(scene);
  assert.ok(
    storyboardKeys !== codeWindow,
    storyboardKeys
      ? "Info.plist поднимает Main.storyboard И SceneDelegate создаёт второе окно — два WebView при запуске"
      : "Нет ни storyboard в Info.plist, ни окна в SceneDelegate — приложение запустится с чёрным экраном",
  );
  if (codeWindow) {
    // Свой контроллер нужен ради регистрации WebPrint в capacitorDidLoad.
    assert.match(scene, /rootViewController\s*=\s*WeSetupViewController\(\)/);
  } else {
    assert.match(read("ios/App/App/Base.lproj/Main.storyboard"), /customClass="WeSetupViewController"/);
  }
  assert.match(read("ios/App/App/WeSetupViewController.swift"), /registerPluginInstance\(WebPrintPlugin\(\)\)/);
});
