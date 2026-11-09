import assert from "node:assert/strict";
import test from "node:test";

import { composeTrialEmail, type TrialEmailInput } from "./emails";

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
  invoice: { number: "512", amountRub: 5980, dueLabel: "24 ноября" },
  payUrl: "https://wesetup.ru/settings/subscription",
  requisitesUrl: "https://wesetup.ru/settings/subscription",
  supportTelegram: "@wesetup_support",
};
const plain = (value: string) => value.replace(/<[^>]+>/g, " ").replace(/ /g, " ").replace(/\s+/g, " ");

test("письмо за 4 рабочих дня: что у клиента сейчас, что потеряет, тариф и счёт", () => {
  const mail = composeTrialEmail(base);
  const text = plain(mail.html);
  assert.equal(mail.subject, "«Кафе «Ромашка»»: пробный период заканчивается 17 ноября");
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
  assert.equal(mail.subject, "«Кафе «Ромашка»»: осталось 2 рабочих дня пробного периода");
  assert.match(text, /Укажите ИНН организации/);
  assert.match(text, /как у вас сейчас/);
  assert.ok(!/уйдут в архив/.test(text));
});
