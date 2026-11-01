import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { JOURNAL_INFO } from "@/content/journal-info";

/**
 * Страница СанПиН 2.3/2.4.4282-26 говорит только то, что уже есть в
 * репозитории (`.agent/tasks/growth-stage3-2026-11/spec.md`, AC4b).
 */

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const page = read("src/app/sanpin-2-3-2-4-4282-26/page.tsx");

describe("страница СанПиН 2.3/2.4.4282-26", () => {
  it("дата и замена 3590-20 — как в глоссарии", () => {
    const glossary = read("src/content/glossary.ts");
    assert.match(glossary, /действующие с 1 сентября 2026 года санитарные правила для общепита\. Заменил СанПиН 2\.3\/2\.4\.3590-20: нумерация другая, требования те же\./);
    assert.match(page, /Действующие с 1 сентября 2026 года санитарные правила для общепита\. Заменили СанПиН 2\.3\/2\.4\.3590-20:\s+нумерация другая, требования те же\./);
    assert.match(page, /С 1 сентября 2026 года\. Он заменил СанПиН 2\.3\/2\.4\.3590-20, который действовал с 2021 года\./);
    assert.match(glossary, /санитарные правила для общепита, действовавшие с 2021 года/);
  });

  it("электронная форма — с теми же условиями, что на /blanki", () => {
    assert.match(read("src/app/blanki/page.tsx"), /разрешает и электронную — при условии, что видно, кто внёс запись, и её нельзя незаметно изменить задним числом\./);
    assert.match(page, /Электронная форма допустима, если видно, кто внёс запись, и её нельзя незаметно изменить задним числом\./);
  });

  it("журналы — из каталога с основанием 4282-26, со ссылками на описание", () => {
    const withBasis = Object.values(JOURNAL_INFO).filter((journal) => journal.normative.some((item) => item.title.includes("4282-26")));
    assert.ok(withBasis.length >= 10, `журналов с основанием: ${withBasis.length}`);
    assert.ok(withBasis.some((journal) => journal.code === "hygiene"));
    assert.match(page, /\.filter\(\(journal\) => journal\.normative\.some\(\(item\) => item\.title\.includes\("4282-26"\)\)\)/);
    assert.match(page, /href=\{`\/journals-info\/\$\{journal\.code\}`\}/);
  });

  it("«Пришла проверка» — тот же состав, что собирает сводный отчёт", () => {
    assert.match(page, /архивом или одним PDF с\s+содержанием: журналы, программа производственного контроля и ХАССП-план, журнал посещений проверяющих, CAPA\./);
    const route = read("src/app/api/reports/compliance-bundle/route.ts");
    assert.match(route, /const format = url\.searchParams\.get\("format"\) === "pdf" \? "pdf" : "zip";/);
    assert.match(route, /\["ХАССП-план \(собрано из разделов\)\.pdf", \(\) => buildHaccpPlanPdf\(bundle\)\]/);
    assert.match(route, /const folder = "Посещения проверяющих";/);
    assert.match(route, /CAPA/);
  });

  it("ссылки на страницу: глоссарий, электронный журнал, sitemap; разметка FAQ", () => {
    assert.match(read("src/app/glossary/[slug]/page.tsx"), /"sanpin-2-3-2-4-4282-26": \{ href: "\/sanpin-2-3-2-4-4282-26"/);
    assert.match(read("src/components/landing/seo-journal-landing.tsx"), /href="\/sanpin-2-3-2-4-4282-26"/);
    assert.match(read("src/app/sitemap.ts"), /\$\{SITE\}\/sanpin-2-3-2-4-4282-26`/);
    assert.match(page, /"@type": "FAQPage"/);
    assert.doesNotMatch(page, /штраф[а-я]* до|обязательно с|ГОСТ Р/);
  });
});
