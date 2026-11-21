import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadMessages } from "../../../i18n/messages";
import { EMAIL_CATALOG, EMAIL_CATALOG_GROUPS } from "../../../lib/email-catalog.server";
import { canAccessPlatformPath, matchPlatformRule } from "../../../lib/platform-access";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// ROOT → «Письма» (спека emails-preheader-text-root-catalog-2026-11-21, AC5).

test("у каждого письма каталога есть название и «когда уходит» на ru, en, uz; у групп — заголовки", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = (await loadMessages(locale)).rootEmails;
    const templates = messages.templates as Record<string, { title: string; when: string }>;
    for (const entry of EMAIL_CATALOG) {
      assert.ok(templates[entry.id]?.title?.trim(), `${locale}: нет названия «${entry.id}»`);
      assert.ok(templates[entry.id]?.when?.trim(), `${locale}: нет «когда уходит» у «${entry.id}»`);
    }
    assert.deepEqual(Object.keys(templates).sort(), EMAIL_CATALOG.map((entry) => entry.id).sort(), `${locale}: лишние или пропущенные письма`);
    for (const group of EMAIL_CATALOG_GROUPS) assert.ok(messages.groups[group]?.trim(), `${locale}: группа ${group}`);
    assert.ok(messages.samplePrefix.startsWith("[") && messages.samplePrefix.endsWith("]"));
    assert.ok((await loadMessages(locale)).rootNavigation.emailTemplates.trim());
  }
});

test("доступ: страница и API — раздел «Мониторинг»; пункт меню «Письма» в группе «Платформа»", () => {
  assert.equal(matchPlatformRule("/root/emails")?.gate, "monitoring");
  assert.equal(matchPlatformRule("/api/root/emails/sample", "POST")?.gate, "monitoring");
  const monitoring = { superadmin: false, sections: ["monitoring"] as const };
  const sales = { superadmin: false, sections: ["sales"] as const };
  assert.equal(canAccessPlatformPath(monitoring, "/root/emails"), true);
  assert.equal(canAccessPlatformPath(monitoring, "/api/root/emails/sample", "POST"), true);
  assert.equal(canAccessPlatformPath(sales, "/root/emails"), false);
  assert.equal(canAccessPlatformPath(sales, "/api/root/emails/sample", "POST"), false);

  const nav = read("../../../components/root/root-nav.tsx");
  const platform = nav.slice(nav.indexOf('key: "platform"'));
  assert.match(platform, /\{ href: "\/root\/emails", label: "emailTemplates", icon: MailCheck \}/);
});

test("«Прислать мне»: только ROOT, только своя рабочая почта, лимит, пометка «[Образец]»", () => {
  const route = read("../../api/root/emails/sample/route.ts");
  const body = route.slice(route.indexOf("export async function POST"));
  assert.match(body, /^export async function POST\(request: Request\) \{\n {2}const session = await requireRoot\(\);/);
  assert.match(body, /where: \{ id: session\.user\.id \}/, "адрес — из своей учётной записи, не из запроса");
  assert.doesNotMatch(route, /data\.to|body\.to|parsed\.data\.to/, "адрес получателя не приходит из запроса");
  assert.match(body, /!isTechnicalEmail\(value\)/);
  assert.match(body, /limiter\.consume\(session\.user\.id\)/);
  assert.match(body, /sendCatalogSample\(id, locale, to, t\("rootEmails\.samplePrefix"\)\)/);
  assert.match(route, /locale: z\.enum\(\["ru", "en", "uz"\]\)/);
});

test("страница: только ROOT, письмо во фрейме без скриптов, словарь rootEmails для клиента", () => {
  const page = read("./page.tsx");
  assert.match(page, /export default async function RootEmailsPage[\s\S]*?\{\n {2}await requireRoot\(\);/);
  assert.match(page, /<DomainMessagesBoundary namespaces=\{\["rootEmails"\]\}>/);
  const client = read("./emails-client.tsx");
  const sandbox = client.match(/sandbox="([^"]*)"/)?.[1] ?? "";
  assert.ok(sandbox.length > 0, "фрейм в песочнице");
  assert.doesNotMatch(sandbox, /allow-scripts|allow-forms|allow-top-navigation/);
  assert.match(client, /fetch\("\/api\/root\/emails\/sample"/);
});
