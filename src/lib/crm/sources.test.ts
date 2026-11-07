import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEMO_SERVICE_KEY } from "@/lib/demo-request";
import {
  CRM_DEMO_SERVICE_KEY,
  mapBlankDownload,
  mapFeedbackReport,
  mapGuestInvoice,
  mapPartnerApplication,
  mapServiceRequest,
  mapSignup,
  mapSupportMessage,
} from "@/lib/crm/sources";

const at = new Date("2026-11-07T09:00:00Z");

describe("CRM: источники обращений → лента", () => {
  it("ключ демо-показа совпадает с формой «Покажите за 15 минут»", () => {
    assert.equal(CRM_DEMO_SERVICE_KEY, DEMO_SERVICE_KEY);
  });

  it("заявка на услугу и показ", () => {
    const base = {
      id: "s1",
      serviceKey: "journals-setup",
      serviceTitle: "Настройка журналов",
      organizationId: null,
      organizationName: null,
      userId: null,
      contactName: " Иван ",
      contactPhone: "+7 900 000-00-00",
      contactEmail: "IVAN@Cafe.ru",
      comment: "Нужно 5 точек",
      scheduledAt: null,
      createdAt: at,
    };
    const item = mapServiceRequest(base);
    assert.equal(item.externalKey, "service:s1");
    assert.equal(item.channel, "service");
    assert.equal(item.direction, "in");
    assert.equal(item.href, "/root/service-requests");
    assert.equal(item.body, "Нужно 5 точек");
    assert.deepEqual(item.identity, { email: "ivan@cafe.ru", phone: "+7 900 000-00-00", name: "Иван", company: null, userId: null, organizationId: null });
    const demo = mapServiceRequest({ ...base, serviceKey: DEMO_SERVICE_KEY, comment: null, scheduledAt: new Date("2026-11-08T07:00:00Z") });
    assert.equal(demo.channel, "demo");
    assert.match(demo.body, /Время показа: 2026-11-08 07:00 UTC/);
  });

  it("обращение с сайта и из бота + ответ поддержки", () => {
    const row = {
      id: "f1",
      type: "support",
      message: "Не печатается журнал",
      userId: "u1",
      userEmail: "79001234567@org1.staff.local",
      userName: "Пётр",
      organizationId: "o1",
      organizationName: "Столовая",
      phone: null,
      source: "telegram",
      telegramChatId: "555",
      responseMessage: "Исправили",
      respondedAt: new Date(at.getTime() + 60_000),
      respondedById: "admin",
      respondedByName: "Алексей",
      createdAt: at,
    };
    const [incoming, reply] = mapFeedbackReport(row);
    assert.equal(incoming.channel, "telegram");
    assert.equal(incoming.subject, "Вопрос в поддержку");
    assert.equal(incoming.identity.email, null, "служебный адрес сотрудника — не контакт");
    assert.equal(incoming.identity.telegramChatId, "555");
    assert.equal(reply.direction, "out");
    assert.equal(reply.externalKey, "feedback-reply:f1");
    assert.equal(reply.authorName, "Алексей");
    assert.equal(mapFeedbackReport({ ...row, source: "site", responseMessage: null, respondedAt: null }).length, 1);
    assert.equal(mapFeedbackReport({ ...row, source: "site" })[0].channel, "feedback");
  });

  it("онлайн-чат: клиент — входящее, оператор — исходящее, рассылка — мимо", () => {
    const thread = { id: "t1", key: "guest:abc", userEmail: "a@b.ru", userName: "Анна", phone: null, organizationId: null, organizationName: null };
    const client = mapSupportMessage({ id: "m1", author: "client", body: "Здравствуйте", attachmentsCount: 0, authorUserId: null, authorName: "Анна", operatorName: null, broadcastId: null, createdAt: at, thread });
    assert.equal(client?.direction, "in");
    assert.equal(client?.externalKey, "chat:m1");
    assert.equal(client?.identity.userId, null, "гостевая ветка — без пользователя");
    const operator = mapSupportMessage({ id: "m2", author: "operator", body: "", attachmentsCount: 1, authorUserId: "admin", authorName: "Админ", operatorName: "Алексей", broadcastId: null, createdAt: at, thread });
    assert.equal(operator?.direction, "out");
    assert.equal(operator?.body, "📎 Вложение");
    assert.equal(operator?.authorName, "Алексей");
    assert.equal(mapSupportMessage({ id: "m3", author: "operator", body: "Новости", attachmentsCount: 0, authorUserId: null, authorName: null, operatorName: null, broadcastId: "b1", createdAt: at, thread }), null);
    const legacy = mapSupportMessage({ id: "m4", author: "client", body: "Привет", attachmentsCount: 0, authorUserId: null, authorName: null, operatorName: null, broadcastId: null, createdAt: at, thread: { ...thread, key: "user123" } });
    assert.equal(legacy?.identity.userId, "user123");
  });

  it("счёт по ИНН, регистрация, бланк, партнёр — события и заявки", () => {
    const invoice = mapGuestInvoice({ id: 42, email: "buh@firm.ru", amountRub: 12000, description: "Тариф «Стандарт», 12 мес.", organizationId: null, buyerJson: { name: "ООО Фирма", inn: "7700000000" }, createdAt: at });
    assert.equal(invoice.direction, "event");
    assert.equal(invoice.externalKey, "invoice:42");
    assert.match(invoice.body, /12\s000 ₽/);
    assert.match(invoice.body, /ООО Фирма, ИНН 7700000000/);
    assert.equal(invoice.identity.company, "ООО Фирма");

    const signup = mapSignup({ id: "o1", name: "Кафе", createdAt: at, owner: { id: "u1", name: "Иван", email: "ivan@cafe.ru", phone: "89001112233" } });
    assert.equal(signup.channel, "signup");
    assert.equal(signup.href, "/root/organizations/o1");
    assert.equal(signup.identity.organizationId, "o1");

    const blank = mapBlankDownload({ id: "l1", email: "x@y.ru", userId: null, organizationId: null, createdAt: at, title: "Журнал бракеража" });
    assert.equal(blank.body, "Шаблон: Журнал бракеража");

    const partner = mapPartnerApplication({ id: "p1", companyName: "Аудит+", inn: "123", city: "Казань", phone: "+79000000000", telegram: "@audit", contactEmail: "p@audit.ru", type: "consultant", applicantUserId: "u5", applicantOrganizationId: "o5", createdAt: at });
    assert.equal(partner.direction, "in");
    assert.match(partner.body, /Тип: консультант/);
    assert.match(partner.body, /Telegram: @audit/);
  });
});
