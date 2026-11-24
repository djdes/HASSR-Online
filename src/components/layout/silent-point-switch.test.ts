import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Смена объекта — без оповещений (владелец, 2026-11-23: «при самостоятельных
 * переходах объектов не показывать оповещение о смене объектов и возможности
 * обратно перейти»; автоматические смены — тоже тихо). Тост смены остаётся
 * у организаций и мини-приложения, но не у переключателя объектов сайта.
 */
const SILENT_FILES = [
  "src/components/layout/location-switcher.tsx",
  "src/components/layout/current-point-switcher.tsx",
  "src/components/layout/point-section-sync.tsx",
  "src/components/journals/point-mode-unavailable.tsx",
  "src/components/layout/point-mismatch-notice.tsx",
  // Мини-приложение и приложение на телефоне — так же (ревью 2026-11-24).
  "src/app/mini/_components/mini-location-switcher.tsx",
];

test("переключатель объектов, автосмена и плашки смены не показывают тост смены", () => {
  for (const file of SILENT_FILES) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /switch-toast|showSwitchToast|switchWithReturn/, file);
    assert.doesNotMatch(source, /returnTo|companySection/, file);
  }
});

test("в шапке офиса нет: подписи «Организация» и пункта «Вся организация» больше нет", () => {
  const source = readFileSync("src/components/layout/current-point-switcher.tsx", "utf8");
  assert.doesNotMatch(source, /captionOffice|ORGANIZATION_VIEW_ID/);
  assert.match(source, /t\("choose"\)/);
  assert.match(source, /t\("create"\)/);
});

test("мини-приложение: в списке только объекты — без «Офис» и «Вся организация»", () => {
  const source = readFileSync("src/app/mini/_components/mini-location-switcher.tsx", "utf8");
  assert.doesNotMatch(source, /ORGANIZATION_VIEW_ID|tPoint\("organization"\)/);
  assert.match(source, /filter\(\(building\) => !isOfficeBuilding\(building\)\)/);
  const shell = readFileSync("src/app/mini/_components/mini-shell-data.ts", "utf8");
  assert.match(shell, /\("choose"\)/);
});
