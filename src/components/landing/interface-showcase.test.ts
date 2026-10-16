import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const page = read("src/app/page.tsx");
const slideIds = [...page.matchAll(/\{ id: "(\w+)", icon: "\w+", address: "wesetup\.ru\/[^"]*" \}/g)].map((match) => match[1]);

test("слайдер кабинета стоит на главной сразу после QR-ролика", () => {
  const qr = page.indexOf('<section id="qr"');
  const showcase = page.indexOf('<section id="interface"');
  const capabilities = page.indexOf("{CAPABILITIES.map");
  assert.ok(qr > 0 && showcase > qr && capabilities > showcase, "порядок: QR-ролик → кабинет → что ещё умеет");
  assert.ok(page.includes("<InterfaceShowcase"), "компонент слайдера подключён");
  assert.ok(slideIds.length >= 5, `экранов не меньше пяти, сейчас ${slideIds.length}`);
});

test("у каждого экрана есть десктопный и мобильный снимок разумного веса", () => {
  for (const id of slideIds) {
    for (const variant of ["desktop", "mobile"]) {
      const file = path.join(ROOT, "public/landing/screens", `${id}-${variant}.webp`);
      assert.ok(existsSync(file), `нет ${id}-${variant}.webp`);
      const size = statSync(file).size;
      assert.ok(size > 8_000, `${id}-${variant}.webp подозрительно мал: ${size} байт`);
      assert.ok(size < 450_000, `${id}-${variant}.webp слишком тяжёлый: ${size} байт`);
    }
  }
});

test("подписи экранов есть во всех трёх каталогах", () => {
  for (const locale of ["ru", "en", "uz"]) {
    const catalog = JSON.parse(read(`src/i18n/messages/${locale}.json`)) as {
      landing: { showcase: Record<string, unknown> & { slides: Record<string, { tab: string; title: string; text: string }> } };
    };
    const showcase = catalog.landing.showcase;
    for (const key of ["title", "lead", "region", "tabs", "previous", "next", "position"]) {
      assert.equal(typeof showcase[key], "string", `${locale}: landing.showcase.${key}`);
    }
    for (const id of slideIds) {
      const slide = showcase.slides[id];
      assert.ok(slide, `${locale}: нет экрана ${id}`);
      for (const field of ["tab", "title", "text"] as const) {
        assert.ok(slide[field]?.trim().length > 0, `${locale}: ${id}.${field}`);
      }
      assert.ok(slide.tab.length <= 18, `${locale}: вкладка «${slide.tab}» длинновата для строки вкладок`);
    }
  }
});
