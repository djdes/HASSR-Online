import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Карандаш «Своё название журнала» на странице журнала (владелец,
 * 2026-09-26) — тем же людям и тем же путём, что страница «Настройки →
 * Названия»: иначе права и проверки у двух мест разойдутся.
 */

function read(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

test("карандаш — у тех же, кому доступна «Названия»; сервер проверяет те же права", () => {
  const journalPage = read("src/app/(dashboard)/journals/[code]/page.tsx");
  assert.match(
    journalPage,
    /<JournalTitleControls canRename=\{hasFullWorkspaceAccess\(session\.user\)\} \/>/,
    "страница журнала: карандаш по hasFullWorkspaceAccess"
  );
  assert.match(
    read("src/app/(dashboard)/settings/names/page.tsx"),
    /if \(!hasFullWorkspaceAccess\(session\.user\)\) redirect/,
    "«Названия»: те же права"
  );
  assert.match(
    read("src/lib/custom-names-save.ts"),
    /if \(!hasFullWorkspaceAccess\(input\.actor\)\)/,
    "API: те же права для PUT и PATCH"
  );
});

test("окно сохраняет тем же API и помощником, что «Названия»", () => {
  const controls = read("src/components/journals/journal-title-controls.tsx");
  assert.match(controls, /fetch\("\/api\/settings\/custom-names", \{\s*method: "PATCH"/);
  assert.match(controls, /checkJournalRename\(/, "поле проверяется общим помощником");
  const route = read("src/app/api/settings/custom-names/route.ts");
  assert.match(route, /export async function PATCH\(request: Request\) \{\s*return save\(request, "merge"\);/);
  assert.match(route, /export async function PUT\(request: Request\) \{\s*return save\(request, "replace"\);/);
  assert.equal((route.match(/saveCustomNames\(/g) ?? []).length, 1, "один вызов saveCustomNames на оба метода");
});

test("у заголовка — компактный переключатель, а не пилюля «Включён · отключить»", () => {
  const topBar = read("src/components/journals/document-list-ui.tsx");
  assert.doesNotMatch(topBar, /JournalEnabledIndicator/);
  const controls = read("src/components/journals/journal-title-controls.tsx");
  assert.match(controls, /<JournalEnabledSwitch\b/);
});
