import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Память сборки на сервере и правила Dependabot (10.11.2026).
 * Куча Node по умолчанию на сервере ~4.1 ГБ — сборке нужно больше, без
 * увеличения деплой падает с «JavaScript heap out of memory». Dependabot не
 * должен снова предлагать обновления, которые проверены и ломают сайт.
 * Замеры: .agent/tasks/deps-update-2026-11-10/raw/step6-build-memory.md
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const HEAP = /--max-old-space-size=(\d+)/;

function section(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  assert.ok(start >= 0, `нет секции «${startMarker}»`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `нет конца секции «${endMarker}»`);
  return text.slice(start, end);
}

describe("память сборки на сервере", () => {
  const deploy = read(".github/workflows/deploy.yml");
  const step2 = section(deploy, "name: Deploy step 2/3", "name: Deploy step 3/3");

  it("шаг 2/3 задаёт кучу ≥ 8 ГБ до обеих сборок и сохраняет прежние NODE_OPTIONS", () => {
    const exportAt = step2.search(/export NODE_OPTIONS="\$\{NODE_OPTIONS:\+\$NODE_OPTIONS \}--max-old-space-size=\d+"/);
    assert.ok(exportAt >= 0, "нет export NODE_OPTIONS с --max-old-space-size");
    const heap = Number(step2.slice(exportAt).match(HEAP)?.[1]);
    assert.ok(heap >= 8192, `куча сборки ${heap} МБ, нужно не меньше 8192`);

    const builds = [...step2.matchAll(/npm run build > \.build(-rebuild)?\.log/g)].map((m) => m.index ?? -1);
    assert.equal(builds.length, 2, "ожидались основная сборка и пересборка");
    for (const at of builds) assert.ok(at > exportAt, "сборка запускается раньше, чем задана куча");
    assert.match(step2, /echo "\[build\] NODE_OPTIONS=\$NODE_OPTIONS"/, "значение должно попадать в лог деплоя");
  });

  it("шаг 3/3 (перезапуск pm2) кучу сборки не наследует", () => {
    const step3 = deploy.slice(deploy.indexOf("name: Deploy step 3/3"));
    assert.doesNotMatch(step3, /NODE_OPTIONS=.*--max-old-space-size/);
  });

  it("ручной деплой scripts/deploy.sh собирает с той же кучей", () => {
    const script = read("scripts/deploy.sh");
    const exportAt = script.indexOf("export NODE_OPTIONS=--max-old-space-size=8192;");
    assert.ok(exportAt >= 0, "нет export NODE_OPTIONS в deploy.sh");
    assert.ok(script.indexOf("npm run build", exportAt) > exportAt, "куча задана после сборки");
  });
});

describe("Dependabot не предлагает проверенные и отложенные обновления", () => {
  const config = read(".github/dependabot.yml");
  const blocks = config.split(/\n\s*- package-ecosystem: /).slice(1);
  const block = (ecosystem: string, directory: string) => {
    const found = blocks.find((b) => b.startsWith(ecosystem) && b.includes(`directory: "${directory}"`));
    assert.ok(found, `нет блока ${ecosystem} ${directory}`);
    return found;
  };
  const ignored = (text: string, name: string) => {
    const at = text.indexOf(`- dependency-name: "${name}"`);
    if (at < 0) return null;
    const rest = text.slice(at + 1);
    const next = rest.search(/\n\s*- dependency-name: |\n\s*- package-ecosystem: /);
    return next < 0 ? rest : rest.slice(0, next);
  };

  it("Next, React и их типы — без минорных и мажорных, патчи безопасности разрешены", () => {
    const root = block("npm", "/");
    for (const name of ["next", "react", "react-dom", "@types/react", "@types/react-dom", "eslint-config-next"]) {
      const rule = ignored(root, name);
      assert.ok(rule, `${name} не в ignore`);
      assert.match(rule, /version-update:semver-minor/, `${name}: минорные должны игнорироваться`);
      assert.match(rule, /version-update:semver-major/, `${name}: мажорные должны игнорироваться`);
      assert.doesNotMatch(rule, /semver-patch/, `${name}: патчи (исправления безопасности) не должны игнорироваться`);
    }
  });

  it("остальные отложенные пакеты тоже в ignore", () => {
    const root = block("npm", "/");
    for (const name of ["undici", "docx", "api-anything", "remotion", "@remotion/*", "eslint", "nodemailer"]) {
      assert.ok(ignored(root, name), `${name} не в ignore`);
    }
    assert.ok(ignored(block("npm", "/mobile"), "typescript"), "typescript в /mobile не в ignore");
  });
});
