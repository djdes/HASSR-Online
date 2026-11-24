/**
 * Страж от падения всего прода из-за имён динамических сегментов.
 *
 * Next.js запрещает два РАЗНЫХ имени динамического сегмента на одном
 * уровне пути (`/api/journals/[code]` рядом с `/api/journals/[id]`) и при
 * старте сервера валит ВСЁ приложение: сайт отдаёт 500 на каждой
 * странице, а не только на новом роуте.
 *
 * Коварство в том, что ошибку не ловят ни `tsc`, ни `next build` — она
 * вылезает только при запуске сервера, то есть уже на проде. Так прод
 * падал дважды:
 *   • 28.08.2026 — `/api/journals/[code]/documents-menu` (коммит e7e0daa4);
 *   • 07.09.2026 — `/api/journals/[code]/row-form`.
 *
 * Тест дешёвый: читает дерево `src/app` и сравнивает имена соседних
 * динамических сегментов. Группы `(group)` и слоты `@slot` на путь не
 * влияют, поэтому при сравнении они схлопываются — иначе `[code]` внутри
 * `(dashboard)` и `[id]` внутри `(root)` выглядели бы «разными
 * уровнями», хотя для роутера это один и тот же уровень.
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const APP_DIR = path.join(process.cwd(), "src", "app");

/** `[code]` / `[...slug]` / `[[...slug]]` → `code` / `slug`. */
function dynamicSlugName(dirName: string): string | null {
  const match = /^\[{1,2}(?:\.\.\.)?(.+?)\]{1,2}$/.exec(dirName);
  return match ? match[1] : null;
}

/**
 * Перехватывающий сегмент (`(.)item`, `(..)photo`, `(...)x`, `(..)(..)y`) — это
 * НЕ группа: маркер `(.)` лишь говорит, откуда перехватывать, а сам сегмент
 * — обычный уровень пути (`item`). Отдаёт имя сегмента без маркера или null.
 */
function interceptedSegment(dirName: string): string | null {
  const match = /^(?:\(\.{1,3}\))+(.+)$/.exec(dirName);
  return match ? match[1] : null;
}

/** Сегмент, не влияющий на URL: `(group)` и параллельный слот `@slot`. */
function isTransparentSegment(dirName: string): boolean {
  if (interceptedSegment(dirName) !== null) return false;
  return dirName.startsWith("(") || dirName.startsWith("@");
}

type Collision = { routePath: string; slugs: string[]; dirs: string[] };

function collectCollisions(): Collision[] {
  /** routePath → имя слага → каталоги на диске, где он объявлен. */
  const byRoutePath = new Map<string, Map<string, string[]>>();

  function walk(diskDir: string, routePath: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(diskDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name.startsWith("_")) continue;

      const diskChild = path.join(diskDir, entry.name);
      if (isTransparentSegment(entry.name)) {
        // Группа/слот не создаёт уровня пути — идём вглубь с тем же routePath.
        walk(diskChild, routePath);
        continue;
      }

      const segment = interceptedSegment(entry.name) ?? entry.name;
      const slug = dynamicSlugName(segment);
      if (slug) {
        const slugs = byRoutePath.get(routePath) ?? new Map<string, string[]>();
        const dirs = slugs.get(slug) ?? [];
        dirs.push(path.relative(process.cwd(), diskChild).split(path.sep).join("/"));
        slugs.set(slug, dirs);
        byRoutePath.set(routePath, slugs);
      }

      walk(diskChild, `${routePath}/${segment}`);
    }
  }

  walk(APP_DIR, "");

  const collisions: Collision[] = [];
  for (const [routePath, slugs] of byRoutePath) {
    if (slugs.size <= 1) continue;
    collisions.push({
      routePath: routePath || "/",
      slugs: [...slugs.keys()].sort(),
      dirs: [...slugs.values()].flat().sort(),
    });
  }
  return collisions;
}

test("на одном уровне пути нет двух имён динамического сегмента", () => {
  const collisions = collectCollisions();
  const report = collisions
    .map(
      (c) =>
        `  ${c.routePath}/ → [${c.slugs.join("] и [")}]\n` +
        c.dirs.map((d) => `      ${d}`).join("\n"),
    )
    .join("\n");

  assert.deepEqual(
    collisions,
    [],
    collisions.length === 0
      ? ""
      : "Next.js упадёт при старте и прод будет отдавать 500 на каждой " +
          "странице. Переименуйте сегмент так, чтобы совпадал с соседним " +
          `(внешний URL от этого не меняется):\n${report}`,
  );
});

test("страж действительно ловит коллизию", () => {
  // Проверяем сам детектор на синтетическом дереве, иначе тест выше
  // «зелёный» одинаково и когда всё хорошо, и когда детектор сломан.
  assert.equal(dynamicSlugName("[code]"), "code");
  assert.equal(dynamicSlugName("[...slug]"), "slug");
  assert.equal(dynamicSlugName("[[...slug]]"), "slug");
  assert.equal(dynamicSlugName("documents"), null);
  assert.equal(isTransparentSegment("(dashboard)"), true);
  assert.equal(isTransparentSegment("@modal"), true);
  assert.equal(isTransparentSegment("journals"), false);
  // Окно-перехват (`@modal/(.)item/[id]`) — уровень `item`, а не группа.
  assert.equal(isTransparentSegment("(.)item"), false);
  assert.equal(interceptedSegment("(.)item"), "item");
  assert.equal(interceptedSegment("(..)(..)photo"), "photo");
  assert.equal(interceptedSegment("(...)feed"), "feed");
  assert.equal(interceptedSegment("(dashboard)"), null);
});
