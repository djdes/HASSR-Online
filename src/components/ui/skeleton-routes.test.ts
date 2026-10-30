import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PageSkeleton } from "./skeleton";
import { isSectionRoot, journalsSkeletonFor, routeSkeletonFor } from "./skeleton-routes";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const APP = "src/app/(dashboard)";

describe("общий скелет кабинета (2026-10-29): у каждого раздела, без прыжка к своему", () => {
  const own = ["dashboard", "journals", "settings"];

  it("раздел со своим скелетом — его, остальным — PageSkeleton с подходящим телом", () => {
    assert.deepEqual(routeSkeletonFor("/dashboard", own), { kind: "section", section: "dashboard" });
    assert.deepEqual(routeSkeletonFor("/dashboard/catch-up", own), { kind: "section", section: "dashboard" });
    assert.deepEqual(routeSkeletonFor("/settings/users/", own), { kind: "section", section: "settings" });
    assert.deepEqual(routeSkeletonFor("/monitoring", own), { kind: "generic", body: "cards" });
    assert.deepEqual(routeSkeletonFor("/batches/abc", own), { kind: "generic", body: "table" });
    assert.deepEqual(routeSkeletonFor("/capa", own), { kind: "generic", body: "list" });
    assert.deepEqual(routeSkeletonFor(null, own), { kind: "generic", body: "cards" });
  });

  it("(dashboard)/loading.tsx есть и берёт скелет по адресу", () => {
    const src = read(`${APP}/loading.tsx`);
    assert.match(src, /^"use client";/);
    assert.match(src, /usePathname\(\)/);
    assert.match(src, /<RouteSkeleton\b/);
  });

  it("каждый клиентский loading.tsx раздела — в выборе общего скелета; серверные — с тем же телом", () => {
    const chooser = read("src/components/layout/route-skeleton.tsx");
    const sections = readdirSync(path.join(ROOT, APP), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(path.join(ROOT, APP, entry.name, "loading.tsx")))
      .map((entry) => entry.name);
    assert.ok(sections.length >= 10, "разделы со своими скелетами нашлись");
    for (const section of sections) {
      const src = read(`${APP}/${section}/loading.tsx`);
      if (/export default async function/.test(src)) {
        // Серверный скелет нельзя подключить в клиентский выбор — то же тело.
        const body = /body="(\w+)"/.exec(src)?.[1];
        assert.ok(body, section);
        assert.deepEqual(routeSkeletonFor(`/${section}`, []), { kind: "generic", body }, section);
      } else {
        assert.ok(chooser.includes(`from "@/app/(dashboard)/${section}/loading"`), `${section}: нет в route-skeleton.tsx`);
      }
    }
  });
});

describe("скелетон по адресу: подстраница не грузится под раскладкой главной страницы раздела", () => {
  it("главная раздела — её скелет, подстраница — общий скелет страницы", () => {
    assert.equal(isSectionRoot("/settings", "/settings"), true);
    assert.equal(isSectionRoot("/settings/", "/settings"), true);
    assert.equal(isSectionRoot("/settings/balance", "/settings"), false);
    assert.equal(isSectionRoot("/settings/users/abc/access", "/settings"), false);
    assert.equal(isSectionRoot("/dashboard/catch-up", "/dashboard"), false);
    assert.equal(isSectionRoot("/mini", "/mini"), true);
    assert.equal(isSectionRoot("/mini/sections", "/mini"), false);
    // Адрес неизвестен — прежний скелет раздела.
    assert.equal(isSectionRoot(null, "/settings"), true);
  });

  it("журналы: каталог, список документов, документ, прочие страницы", () => {
    assert.equal(journalsSkeletonFor("/journals"), "catalog");
    assert.equal(journalsSkeletonFor("/journals/hygiene"), "documents");
    assert.equal(journalsSkeletonFor("/journals/hygiene/documents/cmx1"), "document");
    assert.equal(journalsSkeletonFor("/journals/hygiene/documents/cmx1/verify"), "page");
    assert.equal(journalsSkeletonFor("/journals/hygiene/new"), "page");
    assert.equal(journalsSkeletonFor("/journals/hygiene/guide"), "page");
    assert.equal(journalsSkeletonFor("/journals/traceability/abc"), "page");
    assert.equal(journalsSkeletonFor(null), "catalog");
  });

  it("вложенные loading.tsx выбирают скелет по адресу", () => {
    for (const file of [
      `${APP}/dashboard/loading.tsx`,
      `${APP}/reports/loading.tsx`,
      `${APP}/journals/loading.tsx`,
      `${APP}/journals/[code]/loading.tsx`,
      `${APP}/journals/[code]/documents/[docId]/loading.tsx`,
      "src/app/mini/loading.tsx",
    ]) {
      const src = read(file);
      assert.match(src, /^"use client";/, `${file}: клиентский (читает адрес)`);
      assert.match(src, /usePathname\(\)/, file);
      assert.match(src, /isSectionRoot|journalsSkeletonFor/, file);
    }
    // Хаба настроек больше нет (меню 2026-10-16): у всех подстраниц один
    // скелет — шапка и панель, без тёмного баннера.
    const settings = read(`${APP}/settings/loading.tsx`);
    assert.doesNotMatch(settings, /bg-\[#0b1024\]/);
    assert.match(settings, /<PageSkeleton label=\{tLoading\("settings"\)\} body="panel" \/>/);
  });
});

describe("скелетоны медленных разделов — в едином стиле", () => {
  // Разделы, где страница читает несколько списков из базы или грузит данные
  // уже на клиенте. Быстрым страницам (одна выборка) скелет не нужен:
  // React держит его на экране минимум 300 мс, и он только замедлил бы их.
  const SLOW_SECTIONS = [
    "dashboard",
    "journals",
    "journals/[code]",
    "journals/[code]/documents/[docId]",
    "settings",
    "reports",
    "control-board",
    "journals-progress",
    "team",
    "verifications",
    "batches",
    "bonuses",
    "losses",
  ];

  for (const section of SLOW_SECTIONS) {
    it(`/${section}: есть loading.tsx на общих скелетонах`, () => {
      const file = `${APP}/${section}/loading.tsx`;
      assert.ok(existsSync(path.join(ROOT, file)), `нет ${file}`);
      const src = read(file);
      assert.match(src, /from "@\/components\/ui\/skeleton"/, `${file}: общий компонент скелетона`);
      assert.match(src, /aria-busy="true"|<PageSkeleton\b|<[A-Z]\w*Loading \/>/, `${file}: помечен как загрузка`);
    });
  }

  it("панель платформы (/root) — тоже со скелетом", () => {
    assert.match(read("src/app/root/loading.tsx"), /<PageSkeleton\b/);
  });

  it("клиентские страницы на первой загрузке показывают скелет раздела, а не пустой блок с крутилкой", () => {
    for (const [client, loading] of [
      [`${APP}/control-board/control-board-client.tsx`, "ControlBoardLoading"],
      [`${APP}/team/team-client.tsx`, "TeamLoading"],
      [`${APP}/journals-progress/journals-progress-client.tsx`, "JournalsProgressLoading"],
      [`${APP}/verifications/verifications-client.tsx`, "VerificationsLoading"],
    ] as const) {
      const src = read(client);
      assert.match(src, new RegExp(`import ${loading} from "\\./loading";`), client);
      assert.match(src, new RegExp(`return <${loading} />;`), client);
      assert.doesNotMatch(src, /h-\[200px\] items-center justify-center/, `${client}: пустой блок с крутилкой`);
    }
    // Прогресс журналов не пишет «Все журналы на сегодня готовы» до ответа сервера.
    const progress = read(`${APP}/journals-progress/journals-progress-client.tsx`);
    assert.ok(
      progress.indexOf("if (loading) return <JournalsProgressLoading />;") < progress.indexOf("<PageHeader"),
      "скелет раньше шапки со счётчиками",
    );
    assert.doesNotMatch(read(`${APP}/ideas/ideas-client.tsx`), />Загружаем…</);
  });

  it("PageSkeleton: помечен для экранного диктора, на токенах темы", () => {
    const html = renderToStaticMarkup(
      createElement(PageSkeleton, { label: "Загружаем партии…", body: "table", stats: 4 }),
    );
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /data-page-skeleton="table"/);
    assert.match(html, /<span class="sr-only">Загружаем партии…<\/span>/);
    // Цвет плашек — класс skeleton-shimmer (токены --app-skeleton-* светлой и тёмной темы).
    assert.ok((html.match(/skeleton-shimmer/g) ?? []).length > 10);
    for (const body of ["cards", "list", "panel"] as const) {
      assert.match(
        renderToStaticMarkup(createElement(PageSkeleton, { label: "x", body })),
        new RegExp(`data-page-skeleton="${body}"`),
      );
    }
  });
});
