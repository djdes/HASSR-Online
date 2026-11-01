import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * «Безопасность и данные» обещает только то, что есть в коде и на проде
 * (`.agent/tasks/growth-stage2-2026-11/spec.md`, AC4). Тест сверяет каждое
 * обещание страницы с его источником и не пускает громкие слова.
 */

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const page = read("src/app/security/page.tsx");
const ru = JSON.parse(read("src/i18n/messages/ru.json")) as {
  settingsManagement: { security: { title: string; logoutAll: string } };
  accountDeletion: { page: { ownerDelay: string } };
};

describe("страница «Безопасность и данные»", () => {
  it("хранение в России — как в оферте и согласии", () => {
    assert.match(page, /дата-центре в Москве/);
    assert.match(read("src/app/oferta/page.tsx"), /10\.3\. Данные размещаются и обрабатываются на серверах, расположенных\s+на территории Российской Федерации/);
    assert.match(read("src/app/consent/page.tsx"), /Данные хранятся на серверах, расположенных на территории Российской\s+Федерации/);
  });

  it("шифрование, пароли и вход — как в коде", () => {
    assert.match(page, /HTTPS/);
    assert.match(page, /AES-256-GCM/);
    assert.match(read("src/lib/integration-crypto.ts"), /const ALGORITHM = "aes-256-gcm";/);
    assert.match(page, /хэши \(bcrypt\)/);
    assert.match(read("src/app/api/auth/instant-register/route.ts"), /bcrypt\.hash\(password, 12\)/);
    assert.match(page, /кодом в\s+Telegram/);
    assert.match(read("src/app/api/security/two-factor/route.ts"), /twoFactorTelegram: body\.enabled/);
    assert.match(page, new RegExp(`«Настройки → ${ru.settingsManagement.security.title}»`));
    assert.equal(ru.settingsManagement.security.logoutAll, "Завершить все сессии");
    assert.match(page, /кнопка «Завершить все\s+сессии»/);
  });

  it("доступы, журнал действий, копии, оплата и удаление — как в коде", () => {
    const schema = read("prisma/schema.prisma");
    assert.match(page, /ссылка с ограниченным сроком действия/);
    assert.match(schema, /model InspectorToken \{[\s\S]*?expiresAt\s+DateTime\n/);
    assert.match(page, /Правку прошлых дней можно запретить/);
    assert.match(schema, /lockPastDayEdits\s+Boolean/);
    assert.match(read("src/lib/audit-labels.ts"), /"journal\.entry\.update"/);
    assert.match(page, /Авто-бэкап на\s+Я\.Диск/);
    assert.match(read("src/app/api/settings/yandex-backup/run/route.ts"), /export async function POST/);
    assert.match(page, /«Робокасса»/);
    assert.match(page, /Компания удаляется через 30 дней/);
    assert.match(ru.accountDeletion.page.ownerDelay, /через 30 дней/);
  });

  it("без громких слов: сертификатов, процентов доступности и бэкапов сервера", () => {
    assert.doesNotMatch(page, /ISO|27001|PCI|99[.,]9|сертифиц|резервн\S* копи\S* сервер|каждый час|ежечасн|военн/i);
  });

  it("ссылка в подвале и в sitemap", () => {
    const chrome = read("src/components/public/public-chrome.tsx");
    assert.match(chrome, /href="\/security"[\s\S]{0,200}\{t\("securityAndData"\)\}/);
    assert.match(read("src/app/sitemap.ts"), /\$\{SITE\}\/security`/);
    assert.match(read(".env.shared"), /# Хостинг: VPS в Москве/);
    assert.doesNotMatch(read(".env.shared"), /Azure/);
  });
});
