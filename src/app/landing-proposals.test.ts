import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const page = read("src/app/page.tsx");

test("FAQ на главной — шесть вопросов; убранные ключи удалены из словарей (правки 21.11.2026)", () => {
  const faq = page.slice(page.indexOf("const FAQ = ["), page.indexOf("] as const;", page.indexOf("const FAQ = [")));
  const keys = [...faq.matchAll(/"landing\.faq\.(\w+)\.question"/g)].map((match) => match[1]);
  assert.deepEqual(keys, ["refund", "employeeAccess", "missedEntry", "qrSecurity", "offline", "dataSecurity"]);
  for (const locale of ["ru", "en", "uz"]) {
    const landing = JSON.parse(read(`src/i18n/messages/${locale}.json`)).landing;
    assert.deepEqual(Object.keys(landing.faq).sort(), [...keys].sort(), `${locale}: faq`);
    for (const gone of ["electronicLogs", "inspection", "integrations", "import"]) {
      assert.equal(landing.faqMore[gone], undefined, `${locale}: faqMore.${gone}`);
    }
  }
});

test("«Покажем за 15 минут» — из словарей, не строкой в коде", () => {
  assert.doesNotMatch(page, /Не хотите разбираться сами/);
  assert.ok(page.includes('{copy("landing.demoOffer")}'));
  for (const locale of ["ru", "en", "uz"]) {
    assert.ok(JSON.parse(read(`src/i18n/messages/${locale}.json`)).landing.demoOffer?.length > 0, locale);
  }
});

test("кнопка чёрно-белой печати плакатов читается без «Ч/б» (её путали с «4/6»)", () => {
  const ru = JSON.parse(read("src/i18n/messages/ru.json"));
  assert.equal(ru.settingsUi.qrPostersClient.mono, "Чёрно-белая");
});

test("git-хуки исполняемые: pre-commit запускается при коммите", () => {
  let listing = "";
  try {
    listing = execFileSync("git", ["ls-files", "-s", ".husky/pre-commit", ".husky/pre-push"], { encoding: "utf8" });
  } catch {
    return; // без git (архив исходников) проверять нечего
  }
  for (const line of listing.trim().split("\n")) assert.match(line, /^100755 /, line);
});

test("npm run screens:landing — съёмка только на локальной базе", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["screens:landing"], "tsx scripts/landing-screens.ts");
  const script = read("scripts/landing-screens.ts");
  assert.ok(script.includes('["localhost", "127.0.0.1", "::1"].includes(host)'), "отказ на нелокальной базе");
  assert.ok(script.includes("public/landing/screens/${TODAY}"), "новая съёмка — новая папка с датой");
  assert.ok(script.includes('"ООО «Пример»"'), "«Сотрудники» — вымышленная организация");
});
