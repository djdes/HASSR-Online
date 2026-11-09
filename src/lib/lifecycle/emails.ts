/**
 * Письмо клиенту за 4 и за 2 рабочих дня до конца пробного (2026-11-09):
 * что изменится именно у него, какой тариф подойдёт, счёт и оплата картой.
 * Чистый модуль — тексты проверяет `emails.test.ts`.
 */

import { journalsLabel } from "@/lib/billing-period";
import { pointsLabel } from "@/lib/cabinet-plan";
import { escapeHtml } from "@/lib/html-escape";
import { employeesLabel } from "@/lib/plan-catalog";
import { pluralRu } from "@/lib/plural-ru";

export type TrialEmailInput = {
  stage: "trial_first" | "trial_second";
  orgName: string;
  /** «17 ноября» — последний день пробного. */
  lastDayLabel: string;
  workdaysLeft: number;
  seats: number;
  journals: number;
  points: number;
  freeUsers: number;
  freeJournals: number;
  /** Подобранный тариф: «Стандарт». */
  tierTitle: string;
  monthRub: number;
  yearRub: number;
  /** Счёт уже выставлен (у организации есть ИНН). */
  invoice: { number: string; amountRub: number; dueLabel: string } | null;
  payUrl: string;
  /** Где указать ИНН, чтобы счёт сформировался сам. */
  requisitesUrl: string;
  supportTelegram: string;
};

export type ComposedNotice = { subject: string; title: string; html: string; telegramText: string };

const P = 'style="margin:0 0 16px;color:#3f3f46;line-height:1.6"';
const H = 'style="margin:24px 0 8px;color:#0b1024;font-size:15px;font-weight:600"';
const BOX = 'style="background:#f5f6ff;border-radius:8px;padding:16px 20px;margin:0 0 16px;color:#3848c7;line-height:1.6"';
const BUTTON =
  'style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px"';

export function rub(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} ₽`;
}

function workdays(n: number): string {
  return `${n} ${pluralRu(n, "рабочий день", "рабочих дня", "рабочих дней")}`;
}

/** «на 1 точку», «на 3 точки». */
function forPoints(n: number): string {
  return `на ${n} ${pluralRu(n, "точку", "точки", "точек")}`;
}

export function composeTrialEmail(input: TrialEmailInput): ComposedNotice {
  const org = escapeHtml(input.orgName);
  const now = `${employeesLabel(input.seats)}, ${journalsLabel(input.journals)}, ${pointsLabel(input.points)}`;
  const free = `${employeesLabel(input.freeUsers)} и ${journalsLabel(input.freeJournals)}`;
  const overLimit = input.seats > input.freeUsers || input.journals > input.freeJournals;
  const yearMonthly = Math.round(input.yearRub / 12);
  const offer = `Вам подойдёт тариф «${input.tierTitle}» ${forPoints(input.points)}: ${rub(input.monthRub)} в месяц или ${rub(input.yearRub)} за год (${rub(yearMonthly)} в месяц).`;
  const left = workdays(input.workdaysLeft);
  const subject =
    input.stage === "trial_first"
      ? `«${input.orgName}»: пробный период заканчивается ${input.lastDayLabel}`
      : `«${input.orgName}»: осталось ${left} пробного периода`;

  const losses = overLimit
    ? `<p ${P}>Если не продлить, «${org}» перейдёт на бесплатный тариф — ${free}. Вы сами выберете, кого из сотрудников и какой журнал оставить; остальные сотрудники уйдут в архив, журналы выключатся. Записи и документы сохранятся — после оплаты всё вернётся как было.</p>`
    : `<p ${P}>Если не продлить, «${org}» останется на бесплатном тарифе — ${free}, как у вас сейчас. Подключить команду и все журналы можно в любой момент.</p>`;

  const invoice = input.invoice
    ? `<p ${P}>Мы уже выставили счёт <strong>№${escapeHtml(input.invoice.number)}</strong> на ${rub(input.invoice.amountRub)} — он во вложении. Оплатить по нему можно до ${escapeHtml(input.invoice.dueLabel)}, доступ продлится сам, как только деньги придут.</p>`
    : `<p ${P}>Нужен счёт для бухгалтерии? Укажите ИНН организации на <a href="${input.requisitesUrl}" style="color:#3848c7">странице тарифа</a> — счёт сформируется в один клик.</p>`;

  const html =
    `<p ${P}>Здравствуйте!</p>` +
    `<p ${P}>Пробный период «${org}» действует по ${escapeHtml(input.lastDayLabel)} включительно — ${input.stage === "trial_first" ? "осталось" : "остаётся всего"} ${left}.</p>` +
    `<div ${BOX}>Сейчас у вас: ${escapeHtml(now)}.</div>` +
    `<p ${H}>Что изменится без оплаты</p>` +
    losses +
    `<p ${H}>Чтобы всё осталось как есть</p>` +
    `<p ${P}>${escapeHtml(offer)}</p>` +
    invoice +
    `<p style="margin:0 0 24px"><a href="${input.payUrl}" ${BUTTON}>Продлить доступ</a></p>` +
    `<p ${P}>Остались вопросы или нужно время на согласование — просто ответьте на это письмо или напишите нам в Telegram ${escapeHtml(input.supportTelegram)}.</p>`;

  const telegramText = [
    `⏳ Пробный период «${org}» — по ${escapeHtml(input.lastDayLabel)}, осталось ${left}.`,
    `Сейчас: ${escapeHtml(now)}. ${overLimit ? `Без оплаты останется ${free} — остальные сотрудники уйдут в архив.` : `Без оплаты — бесплатный тариф: ${free}.`}`,
    escapeHtml(offer),
    input.invoice ? `Счёт №${escapeHtml(input.invoice.number)} на ${rub(input.invoice.amountRub)} отправили на почту.` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { subject, title: input.stage === "trial_first" ? "Пробный период заканчивается" : "Пробный период почти закончился", html, telegramText };
}
