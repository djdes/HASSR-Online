import assert from "node:assert/strict";
import test from "node:test";
import { IntlMessageFormat } from "intl-messageformat";

import ru from "@/i18n/messages/ru.json";
import en from "@/i18n/messages/en.json";
import uz from "@/i18n/messages/uz.json";
import { messageHtml } from "@/lib/client-documents";
import {
  CLIENT_EMAIL_TEMPLATE_GROUPS,
  CLIENT_EMAIL_TEMPLATE_IDS,
  fillClientEmailTemplate,
  isClientEmailTemplateId,
  serviceListText,
  tariffListText,
  type ClientEmailTemplateContext,
  type TemplateTranslator,
} from "@/lib/client-email-templates";

type Catalog = typeof ru;
const LOCALES: Record<string, Catalog> = { ru, en: en as Catalog, uz: uz as Catalog };

/** Переводчик как у next-intl: ключ внутри `rootOrganizationManagement.mail.templates`, ICU-подстановки. */
function translator(locale: string): TemplateTranslator {
  const root = LOCALES[locale].rootOrganizationManagement.mail.templates as unknown as Record<string, unknown>;
  return (key, values) => {
    const message = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], root);
    assert.equal(typeof message, "string", `${locale}: нет ключа ${key}`);
    return String(new IntlMessageFormat(message as string, locale).format(values ?? {}));
  };
}

const context: ClientEmailTemplateContext = {
  company: "ООО «Ромашка»",
  links: {
    video: "https://wesetup.ru/landing/video/presentation-extended-ru.mp4",
    pdf: "https://wesetup.ru/landing/wesetup-presentation.pdf",
    site: "https://wesetup.ru",
    register: "https://wesetup.ru/register",
    pricing: "https://wesetup.ru/pricing",
    services: "https://wesetup.ru/uslugi",
    login: "https://wesetup.ru/login",
    knowledge: "https://wesetup.ru/baza-znaniy",
    bot: "https://t.me/wesetupbot",
  },
  supportPhone: "+7 (495) 109-65-43",
  supportTelegram: "@wesetup_support",
  trialDays: 14,
  tariffs: [
    { tier: "standard", month: 2990, year: 1990 },
    { tier: "premium", month: 4990, year: null },
    { tier: "vip", month: null, year: 8990 },
  ],
  services: [
    { title: "Обучение персонала", priceRub: 10000, priceFrom: false, unit: "за группу" },
    { title: "Разработка ППК", priceRub: 10000, priceFrom: true, unit: null },
    { title: "Дезслужба", priceRub: null, priceFrom: false, unit: null },
  ],
};

test("группы шаблонов: после разговора, тарифы и оплата, услуги, поддержка — 17 шаблонов без повторов", () => {
  assert.deepEqual(CLIENT_EMAIL_TEMPLATE_GROUPS.map((group) => group.id), ["followup", "billing", "services", "support"]);
  assert.equal(CLIENT_EMAIL_TEMPLATE_IDS.length, 17);
  assert.equal(new Set(CLIENT_EMAIL_TEMPLATE_IDS).size, CLIENT_EMAIL_TEMPLATE_IDS.length);
  assert.ok(isClientEmailTemplateId("presentation"));
  assert.ok(!isClientEmailTemplateId("__proto__"));
});

test("каждый шаблон на ru/en/uz собирается целиком: тема, обращение, без неподставленных {…}", () => {
  for (const locale of Object.keys(LOCALES)) {
    const t = translator(locale);
    for (const id of CLIENT_EMAIL_TEMPLATE_IDS) {
      const filled = fillClientEmailTemplate(t, id, context, "Анна Смирнова", locale);
      assert.ok(filled.subject.trim(), `${locale}/${id}: тема`);
      assert.ok(filled.subject.length <= 200 && !/[\r\n]/.test(filled.subject), `${locale}/${id}: тема в одну строку`);
      assert.ok(filled.message.length < 20000, `${locale}/${id}: в пределах поля`);
      assert.match(filled.message, /Анна Смирнова/, `${locale}/${id}: обращение по имени`);
      assert.doesNotMatch(filled.message, /[{}]/, `${locale}/${id}: всё подставлено`);
    }
  }
});

test("видеопрезентация и PDF — ссылками с сайта; тарифы и услуги — текущими ценами", () => {
  const t = translator("ru");
  const presentation = fillClientEmailTemplate(t, "presentation", context, null, "ru");
  assert.match(presentation.message, /^Здравствуйте!\n/);
  assert.match(presentation.message, /В продолжение нашего разговора высылаю видеопрезентацию/);
  assert.match(presentation.message, /https:\/\/wesetup\.ru\/landing\/video\/presentation-extended-ru\.mp4/);
  assert.match(presentation.message, /https:\/\/wesetup\.ru\/landing\/wesetup-presentation\.pdf/);
  const tariffs = fillClientEmailTemplate(t, "tariffs", context, null, "ru").message;
  assert.match(tariffs, /• Стандарт — 2\s990 ₽ в месяц, при оплате за год — 1\s990 ₽ в месяц/);
  assert.match(tariffs, /• Премиум — 4\s990 ₽ в месяц\n/);
  assert.match(tariffs, /• ВИП — 8\s990 ₽ в месяц при оплате за год/);
  assert.match(tariffs, /Первые 14 дней — бесплатно/);
  assert.equal(
    serviceListText(t, context.services, "ru").replace(/\s/g, " "),
    "• Обучение персонала — 10 000 ₽ за группу • Разработка ППК — от 10 000 ₽ • Дезслужба — по запросу",
  );
  assert.equal(tariffListText(t, [], "ru"), "");
  assert.match(fillClientEmailTemplate(t, "reminder", { ...context, trialDays: 21 }, null, "ru").message, /21 день/);
});

test("текст письма: ссылки кликабельны и экранированы, длинные адреса переносятся", () => {
  const html = messageHtml('Видео: https://wesetup.ru/a.mp4.\n<b>x</b> https://wesetup.ru/p?a=1&b="2"');
  assert.match(html, /<a href="https:\/\/wesetup\.ru\/a\.mp4" style="[^"]+">https:\/\/wesetup\.ru\/a\.mp4<\/a>\./);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /href="https:\/\/wesetup\.ru\/p\?a=1&amp;b="/);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.doesNotMatch(messageHtml("javascript:alert(1)"), /<a /);
});
