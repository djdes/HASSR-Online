import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { blankConsentRows } from "@/lib/blank-download";
import {
  BLANK_MAILING_BASIS_CONSENT,
  BLANK_MAILING_BASIS_MARKETING,
  BLANK_MAILING_SOURCE,
  GUEST_INVOICE_MAILING_BASIS,
  GUEST_INVOICE_MAILING_SOURCE,
  blankTargetTag,
  mergePdfLeadMarketingContact,
  type ExistingMarketingContactSnapshot,
} from "@/lib/blank-download-lead";
import { mapBlankDownload } from "@/lib/crm/sources";
import { DEFAULT_ORG_NAME } from "@/lib/org-profile";

const REPO_ROOT = process.cwd();

describe("blank-download-lead: сохранение контактов при запросе PDF без кабинета", () => {
  it("создаёт активный контакт в базе рассылки и CRM-запись для гостя (djceed@ya.ru)", () => {
    const plan = mergePdfLeadMarketingContact({
      email: "  DJCEED@YA.RU ",
      existing: null,
      suppressedReason: null,
      marketingConsent: false,
      source: BLANK_MAILING_SOURCE,
      basis: BLANK_MAILING_BASIS_CONSENT,
      tags: [blankTargetTag({ kind: "code", code: "cleaning" })!],
      note: "Шаблон: Журнал уборки",
    });

    assert.equal(plan.action, "create");
    assert.deepEqual(plan.data, {
      email: "djceed@ya.ru",
      name: null,
      company: null,
      sphere: null,
      city: null,
      phone: null,
      tags: ["cleaning"],
      source: BLANK_MAILING_SOURCE,
      basis: BLANK_MAILING_BASIS_CONSENT,
      status: "active",
      note: "Шаблон: Журнал уборки",
    });

    const crmItem = mapBlankDownload({
      id: "consent_1",
      email: "DJCEED@YA.RU",
      userId: null,
      organizationId: null,
      createdAt: new Date("2026-11-09T15:00:00Z"),
      title: "Журнал уборки",
      company: 'МОУ "СОШ с. Березовка"',
    });
    assert.equal(crmItem.channel, "blank");
    assert.equal(crmItem.direction, "event");
    assert.equal(crmItem.identity.email, "djceed@ya.ru");
    assert.equal(crmItem.identity.company, 'МОУ "СОШ с. Березовка"');
    assert.equal(crmItem.body, "Шаблон: Журнал уборки");
  });

  it("фиксирует согласие на рассылку и тег при отмеченной необязательной галке", () => {
    const plan = mergePdfLeadMarketingContact({
      email: "guest@cafe.ru",
      existing: null,
      suppressedReason: null,
      marketingConsent: true,
      source: BLANK_MAILING_SOURCE,
      basis: BLANK_MAILING_BASIS_CONSENT,
      tags: [blankTargetTag({ kind: "paper", paperId: "ot_intro" })!],
      note: "Шаблон: Вводный инструктаж",
    });

    assert.equal(plan.action, "create");
    assert.equal(plan.data.basis, BLANK_MAILING_BASIS_MARKETING);
    assert.deepEqual(plan.data.tags, ["paper-ot_intro", "рассылка"]);
    assert.equal(plan.data.status, "active");
  });

  it("при повторном скачивании дополняет теги, но не затирает ручные заметки и карточку менеджера", () => {
    const existing: ExistingMarketingContactSnapshot = {
      id: "mc_1",
      email: "djceed@ya.ru",
      name: "Дмитрий",
      company: "Кофейня Волна",
      sphere: "cafe",
      city: "Москва",
      phone: "+7 999 111-22-33",
      tags: ["cleaning"],
      source: BLANK_MAILING_SOURCE,
      basis: BLANK_MAILING_BASIS_CONSENT,
      status: "active",
      note: "Позвонить во вторник после 14:00",
    };

    const plan = mergePdfLeadMarketingContact({
      email: "djceed@ya.ru",
      existing,
      suppressedReason: null,
      marketingConsent: true,
      source: BLANK_MAILING_SOURCE,
      basis: BLANK_MAILING_BASIS_CONSENT,
      tags: ["hygiene"],
      note: "Шаблон: Гигиенический журнал",
    });

    assert.equal(plan.action, "update");
    assert.equal(plan.id, "mc_1");
    assert.deepEqual(plan.data, {
      tags: ["cleaning", "hygiene", "рассылка"],
      basis: BLANK_MAILING_BASIS_MARKETING,
    });
  });

  it("подтягивает реальные данные клиента платформы и отсеивает заглушки быстрой регистрации", () => {
    const withPlaceholders = mergePdfLeadMarketingContact({
      email: "owner@bistro.ru",
      existing: null,
      suppressedReason: null,
      marketingConsent: false,
      source: BLANK_MAILING_SOURCE,
      basis: BLANK_MAILING_BASIS_CONSENT,
      tags: ["cleaning"],
      note: null,
      platformClient: {
        userId: "u_1",
        organizationId: "org_1",
        name: "owner@bistro.ru",
        phone: null,
        company: DEFAULT_ORG_NAME,
        sphere: "unknown_custom",
        marketingOptOut: true,
      },
    });

    assert.equal(withPlaceholders.action, "create");
    assert.equal(withPlaceholders.data.name, null);
    assert.equal(withPlaceholders.data.company, null);
    assert.equal(withPlaceholders.data.sphere, null);
    assert.equal(withPlaceholders.data.status, "unsubscribed");

    const withProfile = mergePdfLeadMarketingContact({
      email: "chef@bistro.ru",
      existing: null,
      suppressedReason: null,
      marketingConsent: false,
      source: BLANK_MAILING_SOURCE,
      basis: BLANK_MAILING_BASIS_CONSENT,
      tags: ["cleaning"],
      note: null,
      platformClient: {
        userId: "u_2",
        organizationId: "org_2",
        name: "Анна Смирнова",
        phone: "+7 900 123-45-67",
        company: "Бистро Север",
        sphere: "restaurant",
        marketingOptOut: false,
      },
    });

    assert.equal(withProfile.action, "create");
    assert.equal(withProfile.data.name, "Анна Смирнова");
    assert.equal(withProfile.data.phone, "+7 900 123-45-67");
    assert.equal(withProfile.data.company, "Бистро Север");
    assert.equal(withProfile.data.sphere, "restaurant");
    assert.equal(withProfile.data.status, "active");
  });

  it("уважает стоп-лист EmailSuppression и пропускает технические логины сотрудников", () => {
    const technical = mergePdfLeadMarketingContact({
      email: "79001112233@org1.staff.local",
      existing: null,
      suppressedReason: null,
      marketingConsent: true,
      source: BLANK_MAILING_SOURCE,
      basis: BLANK_MAILING_BASIS_CONSENT,
      tags: [],
      note: null,
    });
    assert.deepEqual(technical, { action: "skip" });

    const bounced = mergePdfLeadMarketingContact({
      email: "bad@domain.ru",
      existing: null,
      suppressedReason: "bounced",
      marketingConsent: true,
      source: BLANK_MAILING_SOURCE,
      basis: BLANK_MAILING_BASIS_CONSENT,
      tags: ["cleaning"],
      note: null,
    });
    assert.equal(bounced.action, "create");
    assert.equal(bounced.data.status, "bounced");
  });

  it("сохраняет гостевой PDF-счёт по ИНН с названием компании и тегом", () => {
    const plan = mergePdfLeadMarketingContact({
      email: "buh@romashka.ru",
      existing: null,
      suppressedReason: null,
      marketingConsent: false,
      source: GUEST_INVOICE_MAILING_SOURCE,
      basis: GUEST_INVOICE_MAILING_BASIS,
      tags: ["счет-по-инн"],
      company: "ООО Ромашка",
      note: "Счёт: Тариф Стандарт (счёт без регистрации)",
    });

    assert.equal(plan.action, "create");
    assert.equal(plan.data.company, "ООО Ромашка");
    assert.equal(plan.data.source, GUEST_INVOICE_MAILING_SOURCE);
    assert.deepEqual(plan.data.tags, ["счет-по-инн"]);
  });

  it("передаёт userId и organizationId в строки LegalConsent, если почта принадлежит клиенту платформы", () => {
    const rows = blankConsentRows({
      email: "client@cafe.ru",
      version: "2026-09-01",
      marketing: true,
      ipAddress: "127.0.0.1",
      userAgent: "Mozilla/5.0",
      userId: "user_42",
      organizationId: "org_42",
    });

    assert.equal(rows.length, 2);
    assert.equal(rows[0].userId, "user_42");
    assert.equal(rows[0].organizationId, "org_42");
    assert.equal(rows[1].userId, "user_42");
    assert.equal(rows[1].organizationId, "org_42");
  });

  it("роуты выдачи PDF без кабинета и разделы /root синхронно подключены к сохранению лидов", () => {
    const blankRoute = readFileSync(
      path.join(REPO_ROOT, "src/app/api/public/blank-download/route.ts"),
      "utf8",
    );
    assert.match(blankRoute, /await\s+ensurePlatformOrganization\(/);
    assert.match(blankRoute, /await\s+recordBlankDownloadLead\(/);
    assert.match(blankRoute, /shouldNotifyBlankDownloadAdmin\(previousDownloadsCount\s*\+\s*alreadyNotifiedCount,\s*accountCreated\)/);
    assert.match(blankRoute, /const\s+dedupeKey\s*=\s*`blank_download:\$\{email\}`/);

    const invoiceService = readFileSync(
      path.join(REPO_ROOT, "src/lib/invoices/service.ts"),
      "utf8",
    );
    assert.match(invoiceService, /await\s+recordGuestInvoiceLead\(/);

    for (const relPath of [
      "src/lib/crm/queries.server.ts",
      "src/lib/mailing/quick.server.ts",
      "src/lib/mailing/contacts.server.ts",
      "src/app/root/blank-downloads/page.tsx",
    ]) {
      const source = readFileSync(path.join(REPO_ROOT, relPath), "utf8");
      assert.match(source, /await\s+ensurePdfLeadsSynced\(/, `${relPath} must sync PDF leads on read`);
    }
  });
});
