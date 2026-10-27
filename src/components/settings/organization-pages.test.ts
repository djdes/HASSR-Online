import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/*
 * «Моя компания» (2026-10-18): секции большой формы реквизитов переехали на
 * свои страницы — «Сведения для документов», «Логотип и цвета», «Контакты и
 * уведомления». Поля не должны ни потеряться, ни задвоиться, а старые якоря
 * `/settings/organization#branding|#documents` — остаться в коде.
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const FORM = "src/components/settings/organization-info-form.tsx";
const DOCUMENTS = "src/components/settings/organization-documents-form.tsx";
const BRANDING = "src/components/settings/organization-branding-form.tsx";
const CONTACTS = "src/components/settings/organization-contacts-form.tsx";
const PAGES = ["documents", "branding", "contacts"].map(
  (name) => `src/app/(dashboard)/settings/organization/${name}/page.tsx`,
);

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("старых якорей формы реквизитов в коде нет — ссылки ведут на новые страницы", () => {
  const offenders = sources(path.join(process.cwd(), "src")).filter((file) =>
    /\/settings\/organization#(branding|documents)/.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(offenders, []);
  // «Добавить логотип» в шапке меню, меню профиля и Mini App берут адрес отсюда.
  assert.match(read("src/components/theme/theme-tiles.tsx"), /BRANDING_SETTINGS_HREF = "\/settings\/organization\/branding"/);
});

test("поля переехали без дублирования: на «Реквизитах» их больше нет", () => {
  const form = read(FORM);
  for (const moved of [
    "journalShortName",
    "legalFullName",
    "directorName",
    "brandColor",
    "logoUrl",
    "OrgLogoUpload",
    "accountantEmail",
    "timezone",
    "form.phone",
    "phoneInputProps",
  ]) {
    assert.ok(!form.includes(moved), `${moved} остался в форме реквизитов`);
  }
  // Что осталось: ИНН и «Найти», название, сфера, адрес, ЕГРЮЛ, смены, подписка.
  for (const kept of ['set("inn"', "lookupByInn", 'set("name"', 'set("type"', 'set("ownershipKind"', 'set("address"', "LegalProfileView", 'set("shiftEndHour"', "lockPastDayEdits", "requireAdminForJournalEdit", "/settings/subscription"]) {
    assert.ok(form.includes(kept), `${kept} пропал с «Реквизитов»`);
  }
  // Короткие ссылки на соседние страницы.
  for (const href of ["/settings/organization/documents", "/settings/organization/branding", "/settings/organization/contacts"]) {
    assert.ok(form.includes(href), href);
  }
});

test("у каждого переехавшего поля есть своя новая страница", () => {
  const owners: Record<string, string> = {
    journalShortName: DOCUMENTS,
    legalFullName: DOCUMENTS,
    '"kpp"': DOCUMENTS,
    '"ogrn"': DOCUMENTS,
    legalAddress: DOCUMENTS,
    directorName: DOCUMENTS,
    directorPost: DOCUMENTS,
    "/api/settings/buildings/": DOCUMENTS,
    brandColor: BRANDING,
    OrgLogoUpload: BRANDING,
    "logoUrl": BRANDING,
    accountantEmail: CONTACTS,
    timezone: CONTACTS,
    '"locale"': CONTACTS,
    '"phone"': CONTACTS,
    "/settings/notifications": CONTACTS,
  };
  const files = [DOCUMENTS, BRANDING, CONTACTS].map((file) => [file, read(file)] as const);
  for (const [token, owner] of Object.entries(owners)) {
    const holders = files.filter(([, text]) => text.includes(token)).map(([file]) => file);
    assert.ok(holders.includes(owner), `${token} нет в ${owner}`);
  }
  // Предпросмотр — те же функции, что у PDF, а не своя сборка строки.
  const documents = read(DOCUMENTS);
  for (const fn of ["buildDocumentOrgBlock(", "journalHeaderOrgText(", "documentOrgRows("]) assert.ok(documents.includes(fn), fn);
  const branding = read(BRANDING);
  for (const fn of ["resolvePrintColors(", "resolvePrintBrand("]) assert.ok(branding.includes(fn), fn);
});

test("новые страницы закрыты так же, как «Реквизиты»: только admin.full", () => {
  for (const page of PAGES) {
    const text = read(page);
    assert.match(text, /if \(!hasCapability\(session\.user, "admin\.full"\)\) redirect\("\/settings"\);/, page);
    assert.ok(text.includes("<SectionPageHeader"), page);
    assert.ok(text.includes("<PageGuide"), page);
  }
});
