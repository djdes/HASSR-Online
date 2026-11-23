import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Тексты для клиента — простым языком (владелец, 2026-11-23): «Убрать по сайту
 * жаргон слова «пушится» и т. д., … чтобы взрослый, который не разбирается в
 * программировании, смог понять. В переводах тоже» и «TasksFlow — везде
 * «Программный модуль»». Сторож на словари ru/en/uz: корневая панель платформы,
 * юридические тексты и инструменты разработчика не проверяются.
 */
const EXCLUDED = ["root", "publicPrivacy", "publicLegalRequisites", "publicPartners.agreement", "dashboardUi.superUserDevTools", "translationEditor"];

type Catalog = Record<string, unknown>;

function strings(value: unknown, path: string[] = [], out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof value === "string") out.push([path.join("."), value]);
  else if (Array.isArray(value)) value.forEach((item, index) => strings(item, [...path, String(index)], out));
  else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) strings(item, [...path, key], out);
  return out;
}

function clientStrings(locale: "ru" | "en" | "uz"): Array<[string, string]> {
  const catalog = JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, "utf8")) as Catalog;
  return strings(catalog).filter(([key]) => !EXCLUDED.some((prefix) => key === prefix || key.startsWith(`${prefix}.`) || (prefix === "root" && key.startsWith("root"))));
}

/** Видимый текст: без аргументов ICU и адреса сайта сервиса задач. */
function visible(text: string): string {
  return text.replace(/\{[^{}]*\}/g, " ").replace(/tasksflow\.ru/gi, " ");
}

const COMMON: Array<[string, RegExp]> = [
  ["TasksFlow", /TasksFlow/],
  ["pipeline", /pipeline/i],
  ["legacy", /legacy/i],
  ["fallback", /fallback/i],
  ["cron", /\bcron\b/i],
  ["resync", /resync/i],
  ["IoT", /\bIoT\b/],
  ["адрес /settings/ в тексте", /\/settings\//],
  ["код роли head_chef", /head_chef/],
];

const RUSSIAN: Array<[string, RegExp]> = [
  ...COMMON,
  ["пушится / пуш", /(?<![а-яё])(за)?пуш(?!ер)/i],
  ["синк", /(?<![а-яё])синк/i],
  ["фичи", /(?<![а-яё])фич[аиуе]/i],
  ["юзер", /юзер/i],
  ["дефолт", /дефолт/i],
  ["дашборд", /дашборд/i],
  ["пресет", /пресет/i],
  ["пайплайн", /пайплайн/i],
  ["легаси", /легаси/i],
  ["кастомный", /кастом/i],
  ["маппинг", /маппинг/i],
  ["верификер", /верификер/i],
  ["алерт", /(?<![а-яё])алерт/i],
  ["лендинг", /лендинг/i],
  ["custom / pinned / override / scope / toggle", /\b(custom|pinned|override|scope|toggle)\b/i],
];

test("клиентские тексты — без «TasksFlow» и жаргона разработчиков (ru, en, uz)", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const rules = locale === "ru" ? RUSSIAN : COMMON;
    const found: string[] = [];
    for (const [key, text] of clientStrings(locale)) {
      const shown = visible(text);
      for (const [name, pattern] of rules) {
        if (pattern.test(shown)) found.push(`${locale} ${key}: «${name}» — ${text.slice(0, 120)}`);
      }
    }
    assert.deepEqual(found, [], `${locale}: жаргон в текстах`);
  }
});

test("сервис задач называется «Программный модуль»; на странице подключения и в «Сотрудниках» — ссылка на сайт", () => {
  const catalogs = Object.fromEntries(
    (["ru", "en", "uz"] as const).map((locale) => [locale, JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, "utf8"))]),
  ) as Record<"ru" | "en" | "uz", { navigation: { sections: { tasksflow: { label: string } }; routes: Record<string, string> }; settingsUi: { tasksflowSettingsClient: { pageDescription: string } }; phoneBinding: { sidebar: { tasksflow: string } }; sharedUi: { tasksflowPromoHint: { serviceName: string } } }>;
  const names = { ru: "Программный модуль", en: "Software module", uz: "Dasturiy modul" } as const;
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = catalogs[locale];
    assert.equal(messages.navigation.sections.tasksflow.label, names[locale]);
    assert.equal(messages.navigation.routes.settings_integrations_tasksflow, names[locale]);
    assert.equal(messages.sharedUi.tasksflowPromoHint.serviceName, names[locale]);
    // Страница подключения и «Сотрудники → Телефон»: «сервис …» со ссылкой <link>tasksflow.ru</link>.
    assert.match(messages.settingsUi.tasksflowSettingsClient.pageDescription, /<link>tasksflow\.ru<\/link>/);
    assert.match(messages.phoneBinding.sidebar.tasksflow, /<link>tasksflow\.ru<\/link>/);
  }
  assert.match(catalogs.ru.phoneBinding.sidebar.tasksflow, /сервис задач для сотрудников/);
  assert.match(catalogs.ru.settingsUi.tasksflowSettingsClient.pageDescription, /сервис задач для сотрудников/);
  const phone = readFileSync("src/app/(dashboard)/settings/phone/phone-binding-client.tsx", "utf8");
  assert.match(phone, /t\.rich\("sidebar\.tasksflow", \{[\s\S]*?link: chunks => \([\s\S]*?href=\{TASKSFLOW_SITE_URL\}/);
});
