import assert from "node:assert/strict";
import test from "node:test";

import { composeGraceLastEmail, composeIdleTrialEmail, composeRenewalEarlyEmail, composeTrialEmail, greeting, quoted, yearSavings, type TrialEmailInput } from "./emails";

const base: TrialEmailInput = {
  stage: "trial_first",
  orgName: "Кафе «Ромашка»",
  lastDayLabel: "17 ноября",
  workdaysLeft: 4,
  seats: 12,
  journals: 18,
  points: 2,
  freeUsers: 1,
  freeJournals: 1,
  tierTitle: "Стандарт",
  monthRub: 5980,
  yearRub: 47760,
  invoice: { number: "512", amountRub: 5980, dueLabel: "24 ноября", cycle: "month" },
  payUrl: "https://wesetup.ru/settings/subscription",
  requisitesUrl: "https://wesetup.ru/settings/subscription",
  supportTelegram: "@wesetup_support",
  recipientName: "Ирина Смирнова",
  manager: { name: "Алексей Петров", position: "Менеджер по работе с клиентами", phone: "+7 900 123-45-67", email: "alexey@wesetup.ru" },
};
const plain = (value: string) => value.replace(/<[^>]+>/g, " ").replace(/ /g, " ").replace(/\s+/g, " ");

test("письмо за 4 рабочих дня: что у клиента сейчас, что потеряет, тариф и счёт", () => {
  const mail = composeTrialEmail(base);
  const text = plain(mail.html);
  // Название уже в кавычках — вторых не добавляем.
  assert.equal(mail.subject, "Кафе «Ромашка»: пробный период заканчивается 17 ноября");
  assert.match(text, /Здравствуйте, Ирина Смирнова!/);
  assert.match(text, /За год выгоднее на 24 000 ₽/);
  assert.match(text, /Алексей Петров Менеджер по работе с клиентами \+7 900 123-45-67 alexey@wesetup\.ru/);
  assert.match(mail.text, /Алексей Петров\nМенеджер по работе с клиентами/);
  assert.ok(!/«Кафе «Ромашка»»/.test(text));
  assert.match(text, /осталось 4 рабочих дня/);
  assert.match(text, /Сейчас у вас: 12 сотрудников, 18 журналов, 2 точки\./);
  assert.match(text, /бесплатный тариф — 1 сотрудник и 1 журнал\. Вы сами выберете/);
  assert.match(text, /тариф «Стандарт» на 2 точки: 5 980 ₽ в месяц или 47 760 ₽ за год \(3 980 ₽ в месяц\)/);
  assert.match(text, /счёт №512 на 5 980 ₽ — он во вложении\. Оплатить по нему можно до 24 ноября/);
  assert.match(mail.telegramText, /остальные сотрудники уйдут в архив/);
});

test("без ИНН — как получить счёт; в пределах бесплатного — ничего не теряет", () => {
  const mail = composeTrialEmail({ ...base, stage: "trial_second", workdaysLeft: 2, seats: 1, journals: 1, invoice: null });
  const text = plain(mail.html);
  assert.equal(mail.subject, "Кафе «Ромашка»: осталось 2 рабочих дня пробного периода");
  assert.match(text, /Укажите ИНН организации/);
  assert.match(text, /как у вас сейчас/);
  assert.ok(!/уйдут в архив/.test(text));
});

test("кавычки, обращение и выгода за год", () => {
  assert.equal(quoted("Ромашка"), "«Ромашка»");
  assert.equal(quoted("ООО \"Ромашка\""), "ООО \"Ромашка\"");
  assert.equal(greeting(null), "Здравствуйте!");
  assert.equal(greeting("ivan_2024@mail.ru"), "Здравствуйте!");
  assert.equal(yearSavings(5980, 47760), 24000);
  assert.equal(yearSavings(1000, 12000), 0);
});

test("не начали вести журналы — без счёта, предложение продлить пробный", () => {
  const mail = composeIdleTrialEmail({ ...base, lastDayLabel: "17 ноября", workdaysLeft: 4, helpUrl: "https://wesetup.ru/journals" });
  const text = plain(mail.html);
  assert.equal(mail.subject, "Кафе «Ромашка»: продлим пробный период и поможем начать");
  assert.match(text, /продлим пробный период/);
  assert.ok(!/счёт/i.test(text));
  assert.match(mail.text, /Алексей Петров/);
});

test("последние дни отсрочки и годовой «оплатите заранее»", () => {
  const grace = composeGraceLastEmail({ ...base, reason: "trial_ended", lastDayLabel: "24 ноября", workdaysLeft: 2 });
  const text = plain(grace.html);
  assert.match(text, /отсрочке — она действует по 24 ноября включительно/);
  assert.match(text, /11 сотрудников уйдут в архив, 17 журналов выключатся/);
  assert.match(text, /Счёт №512 на 5 980 ₽ — во вложении/);
  const early = composeRenewalEarlyEmail({ ...base, lastDayLabel: "10 декабря", daysLeft: 30, planLabel: "«Стандарт», 2 точ.", amountRub: 47760, invoice: { number: "700", amountRub: 47760, dueLabel: "1 декабря" } });
  assert.equal(early.subject, "Кафе «Ромашка»: годовой тариф заканчивается 10 декабря — продлите заранее");
  assert.match(plain(early.html), /Оплатить лучше заранее/);
  assert.match(plain(early.html), /Счёт №700 на 47 760 ₽ — во вложении/);
});
