/**
 * Письма сценария «пробный и оплата» (2026-11-09, доработаны 2026-11-10):
 * за 4 и за 2 рабочих дня до конца пробного, «не начали — продлим пробный»,
 * последний день отсрочки и «оплатите годовой заранее». Что изменится
 * именно у этого клиента, какой тариф подойдёт, счёт и оплата картой;
 * обращение по имени и подпись ответственного менеджера — ответ на письмо
 * уходит ему (Reply-To ставит `job.server.ts`). Чистый модуль — тексты
 * проверяет `emails.test.ts`.
 */

import { journalsLabel } from "@/lib/billing-period";
import { pointsLabel } from "@/lib/cabinet-plan";
import { escapeHtml } from "@/lib/html-escape";
import { employeesLabel } from "@/lib/plan-catalog";
import { pluralRu } from "@/lib/plural-ru";

/** Подпись письма: ответственный менеджер; null — «Команда WeSetup». */
export type ManagerSignature = { name: string; position: string | null; phone: string | null; email: string | null };

type Common = {
  orgName: string;
  /** Как обратиться: имя владельца аккаунта; null — «Здравствуйте!». */
  recipientName: string | null;
  manager: ManagerSignature | null;
  payUrl: string;
  supportTelegram: string;
};

export type TrialEmailInput = Common & {
  stage: "trial_first" | "trial_second";
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
  invoice: { number: string; amountRub: number; dueLabel: string; cycle: "month" | "year" } | null;
  /** Где указать ИНН, чтобы счёт сформировался сам. */
  requisitesUrl: string;
};

export type ComposedNotice = { subject: string; title: string; html: string; text: string; telegramText: string };

const P = 'style="margin:0 0 16px;color:#3f3f46;line-height:1.6"';
const H = 'style="margin:24px 0 8px;color:#0b1024;font-size:15px;font-weight:600"';
const BOX = 'style="background:#f5f6ff;border-radius:8px;padding:16px 20px;margin:0 0 16px;color:#3848c7;line-height:1.6"';
const WARN = 'style="background:#fff8eb;border-radius:8px;padding:16px 20px;margin:0 0 16px;color:#7a4a00;line-height:1.6"';
const BUTTON =
  'style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px"';

export function rub(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU").replace(/\s/g, " ")} ₽`;
}

/** Название в кавычках: «Ромашка» — но Кафе «Ромашка» второй раз не кавычим. */
export function quoted(name: string): string {
  const trimmed = name.trim();
  return /[«»"“”„]/.test(trimmed) ? trimmed : `«${trimmed}»`;
}

function workdays(n: number): string {
  return `${n} ${pluralRu(n, "рабочий день", "рабочих дня", "рабочих дней")}`;
}

/** «на 1 точку», «на 3 точки». */
function forPoints(n: number): string {
  return `на ${n} ${pluralRu(n, "точку", "точки", "точек")}`;
}

/** «Здравствуйте, Ирина!» — только по похожему на имя; логин или почту не подставляем. */
export function greeting(name: string | null): string {
  const clean = (name ?? "").trim().replace(/\s+/g, " ");
  if (!clean || clean.length > 60 || /[@\d_]/.test(clean)) return "Здравствуйте!";
  return `Здравствуйте, ${clean}!`;
}

/** Выгода оплаты за год против 12 месяцев; 0 — не выгоднее. */
export function yearSavings(monthRub: number, yearRub: number): number {
  return Math.max(0, Math.round(monthRub * 12 - yearRub));
}

function signature(manager: ManagerSignature | null): { html: string; text: string } {
  if (!manager) return { html: `<p style="margin:20px 0 0;color:#3f3f46">Команда WeSetup</p>`, text: "Команда WeSetup" };
  const lines = [manager.name, manager.position, manager.phone, manager.email].map((line) => (line ?? "").trim()).filter(Boolean);
  return {
    html: `<p style="margin:20px 0 0;color:#3f3f46;line-height:1.5">${lines.map(escapeHtml).join("<br>")}<br><span style="color:#9b9fb3">WeSetup — электронные журналы ХАССП</span></p>`,
    text: [...lines, "WeSetup — электронные журналы ХАССП"].join("\n"),
  };
}

/** Блок письма: HTML и та же мысль простым текстом (для text/plain-части). */
type Block = { html: string; text: string };
const para = (text: string, style = P): Block => ({ html: `<p ${style}>${escapeHtml(text)}</p>`, text });
const heading = (text: string): Block => ({ html: `<p ${H}>${escapeHtml(text)}</p>`, text: text.toUpperCase() });
const box = (text: string, style = BOX): Block => ({ html: `<div ${style}>${escapeHtml(text)}</div>`, text });
const button = (label: string, url: string): Block => ({ html: `<p style="margin:0 0 24px"><a href="${url}" ${BUTTON}>${escapeHtml(label)}</a></p>`, text: `${label}: ${url}` });

function join(blocks: Block[]): { html: string; text: string } {
  return { html: blocks.map((block) => block.html).join(""), text: blocks.map((block) => block.text).join("\n\n") };
}

function replyLine(input: Common): Block {
  return para(
    input.manager
      ? `Остались вопросы или нужно время на согласование — просто ответьте на это письмо, оно придёт мне. Или напишите нам в Telegram ${input.supportTelegram}.`
      : `Остались вопросы или нужно время на согласование — просто ответьте на это письмо или напишите нам в Telegram ${input.supportTelegram}.`,
  );
}

function offerText(input: Pick<TrialEmailInput, "tierTitle" | "points" | "monthRub" | "yearRub">): string {
  const yearMonthly = Math.round(input.yearRub / 12);
  return `Вам подойдёт тариф «${input.tierTitle}» ${forPoints(input.points)}: ${rub(input.monthRub)} в месяц или ${rub(input.yearRub)} за год (${rub(yearMonthly)} в месяц).`;
}

function savingsText(monthRub: number, yearRub: number): string | null {
  const save = yearSavings(monthRub, yearRub);
  return save > 0 ? `За год выгоднее на ${rub(save)}, чем платить помесячно.` : null;
}

export function composeTrialEmail(input: TrialEmailInput): ComposedNotice {
  const org = quoted(input.orgName);
  const now = `${employeesLabel(input.seats)}, ${journalsLabel(input.journals)}, ${pointsLabel(input.points)}`;
  const free = `${employeesLabel(input.freeUsers)} и ${journalsLabel(input.freeJournals)}`;
  const overLimit = input.seats > input.freeUsers || input.journals > input.freeJournals;
  const offer = offerText(input);
  const savings = savingsText(input.monthRub, input.yearRub);
  const left = workdays(input.workdaysLeft);
  const subject =
    input.stage === "trial_first"
      ? `${org}: пробный период заканчивается ${input.lastDayLabel}`
      : `${org}: осталось ${left} пробного периода`;

  const losses = overLimit
    ? `Если не продлить, ${org} перейдёт на бесплатный тариф — ${free}. Вы сами выберете, кого из сотрудников и какой журнал оставить; остальные сотрудники уйдут в архив, журналы выключатся. Записи и документы сохранятся — после оплаты всё вернётся как было.`
    : `Если не продлить, ${org} останется на бесплатном тарифе — ${free}, как у вас сейчас. Подключить команду и все журналы можно в любой момент.`;

  const invoice: Block = input.invoice
    ? {
        html: `<p ${P}>Мы уже выставили счёт <strong>№${escapeHtml(input.invoice.number)}</strong> на ${rub(input.invoice.amountRub)}${input.invoice.cycle === "year" ? " (за год)" : ""} — он во вложении. Оплатить по нему можно до ${escapeHtml(input.invoice.dueLabel)}, доступ продлится сам, как только деньги придут.</p>`,
        text: `Мы уже выставили счёт №${input.invoice.number} на ${rub(input.invoice.amountRub)}${input.invoice.cycle === "year" ? " (за год)" : ""} — он во вложении. Оплатить по нему можно до ${input.invoice.dueLabel}, доступ продлится сам, как только деньги придут.`,
      }
    : {
        html: `<p ${P}>Нужен счёт для бухгалтерии? Укажите ИНН организации на <a href="${input.requisitesUrl}" style="color:#3848c7">странице тарифа</a> — счёт сформируется в один клик.</p>`,
        text: `Нужен счёт для бухгалтерии? Укажите ИНН организации на странице тарифа — счёт сформируется в один клик: ${input.requisitesUrl}`,
      };

  const body = join([
    para(greeting(input.recipientName)),
    para(`Пробный период ${org} действует по ${input.lastDayLabel} включительно — ${input.stage === "trial_first" ? "осталось" : "остаётся всего"} ${left}.`),
    box(`Сейчас у вас: ${now}.`),
    heading("Что изменится без оплаты"),
    para(losses),
    heading("Чтобы всё осталось как есть"),
    para(offer),
    ...(savings ? [para(savings)] : []),
    invoice,
    para("Оплатить лучше заранее: бухгалтерии и директору нужно время на согласование, а в выходные платежи не проходят."),
    button("Продлить доступ", input.payUrl),
    replyLine(input),
    signature(input.manager),
  ]);

  const telegramText = [
    `⏳ Пробный период ${escapeHtml(org)} — по ${escapeHtml(input.lastDayLabel)}, осталось ${left}.`,
    `Сейчас: ${escapeHtml(now)}. ${overLimit ? `Без оплаты останется ${free} — остальные сотрудники уйдут в архив.` : `Без оплаты — бесплатный тариф: ${free}.`}`,
    escapeHtml([offer, savings].filter(Boolean).join(" ")),
    input.invoice ? `Счёт №${escapeHtml(input.invoice.number)} на ${rub(input.invoice.amountRub)} отправили на почту.` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    subject,
    title: input.stage === "trial_first" ? "Пробный период заканчивается" : "Пробный период почти закончился",
    ...body,
    telegramText,
  };
}

export type IdleTrialEmailInput = Common & { lastDayLabel: string; workdaysLeft: number; helpUrl: string };

/**
 * Пробный кончается, а журналы так и не начали вести: счёт не к месту —
 * предлагаем помочь с настройкой и продлить пробный, ответив на письмо.
 */
export function composeIdleTrialEmail(input: IdleTrialEmailInput): ComposedNotice {
  const org = quoted(input.orgName);
  const left = workdays(input.workdaysLeft);
  const body = join([
    para(greeting(input.recipientName)),
    para(`Пробный период ${org} действует по ${input.lastDayLabel} включительно — осталось ${left}. Мы видим, что журналы в WeSetup ещё не начали вести.`),
    box("Не успели разобраться? Ответьте на это письмо — продлим пробный период и поможем настроить журналы под вашу кухню: обычно это занимает 15 минут."),
    para("Что можно сделать уже сейчас: добавить сотрудников, включить нужные журналы и сделать первую запись — гигиену или температуру холодильников."),
    button("Открыть журналы", input.helpUrl),
    replyLine(input),
    signature(input.manager),
  ]);
  return {
    subject: `${org}: продлим пробный период и поможем начать`,
    title: "Поможем начать",
    ...body,
    telegramText: `👋 Пробный период ${escapeHtml(org)} — по ${escapeHtml(input.lastDayLabel)}, а журналы ещё не начали вести. Ответьте на письмо — продлим пробный и поможем настроить.`,
  };
}

export type GraceLastEmailInput = Common & {
  /** Почему нужно решение: кончился пробный или оплата. */
  reason: "trial_ended" | "subscription_expired";
  /** «21 ноября» — последний день отсрочки. */
  lastDayLabel: string;
  workdaysLeft: number;
  seats: number;
  journals: number;
  freeUsers: number;
  freeJournals: number;
  tierTitle: string;
  points: number;
  monthRub: number;
  yearRub: number;
  invoice: { number: string; amountRub: number; dueLabel: string; cycle: "month" | "year" } | null;
  requisitesUrl: string;
};

/** Последние рабочие дни отсрочки: что именно отключится и как сохранить. */
export function composeGraceLastEmail(input: GraceLastEmailInput): ComposedNotice {
  const org = quoted(input.orgName);
  const archived = Math.max(0, input.seats - input.freeUsers);
  const off = Math.max(0, input.journals - input.freeJournals);
  const losses = [archived > 0 ? `${employeesLabel(archived)} уйдут в архив` : null, off > 0 ? `${journalsLabel(off)} выключатся` : null].filter(Boolean).join(", ");
  const head = input.reason === "subscription_expired" ? "Оплаченный срок закончился" : "Пробный период закончился";
  const body = join([
    para(greeting(input.recipientName)),
    para(`${head}, и ${org} работает в отсрочке — она действует по ${input.lastDayLabel} включительно (осталось ${workdays(input.workdaysLeft)}).`),
    box(`Если не оплатить, аккаунт перейдёт на бесплатный тариф — ${employeesLabel(input.freeUsers)} и ${journalsLabel(input.freeJournals)}${losses ? `: ${losses}` : ""}. Записи сохранятся, но вести журналы командой будет нельзя.`, WARN),
    para(offerText(input)),
    input.invoice
      ? para(`Счёт №${input.invoice.number} на ${rub(input.invoice.amountRub)}${input.invoice.cycle === "year" ? " (за год)" : ""} — во вложении. Пришлите платёжку в ответ на письмо, и мы не будем отключать команду, пока идут деньги.`)
      : {
          html: `<p ${P}>Нужен счёт? Укажите ИНН на <a href="${input.requisitesUrl}" style="color:#3848c7">странице тарифа</a> — он сформируется сразу. Картой — мгновенно.</p>`,
          text: `Нужен счёт? Укажите ИНН на странице тарифа — он сформируется сразу. Картой — мгновенно: ${input.requisitesUrl}`,
        },
    button("Оплатить и сохранить команду", input.payUrl),
    replyLine(input),
    signature(input.manager),
  ]);
  return {
    subject: `${org}: последние дни, чтобы сохранить команду и журналы`,
    title: "Последние дни отсрочки",
    ...body,
    telegramText: `⚠️ ${escapeHtml(org)}: отсрочка — по ${escapeHtml(input.lastDayLabel)}. Без оплаты аккаунт перейдёт на бесплатный тариф${losses ? ` (${escapeHtml(losses)})` : ""}.${input.invoice ? ` Счёт №${escapeHtml(input.invoice.number)} — на почте.` : ""}`,
  };
}

export type RenewalEarlyEmailInput = Common & {
  /** «10 декабря» — последний оплаченный день. */
  lastDayLabel: string;
  daysLeft: number;
  /** ««Стандарт», 2 точки» — что оплачено. */
  planLabel: string;
  amountRub: number | null;
  invoice: { number: string; amountRub: number; dueLabel: string } | null;
  requisitesUrl: string;
};

/** Годовой тариф: за месяц — «оплатите заранее», со счётом на следующий год. */
export function composeRenewalEarlyEmail(input: RenewalEarlyEmailInput): ComposedNotice {
  const org = quoted(input.orgName);
  const days = `${input.daysLeft} ${pluralRu(input.daysLeft, "день", "дня", "дней")}`;
  const body = join([
    para(greeting(input.recipientName)),
    para(`Год работы ${org} в WeSetup оплачен по ${input.lastDayLabel} — осталось ${days}. Спасибо, что вы с нами!`),
    box(`Продление: ${input.planLabel}${input.amountRub ? ` — ${rub(input.amountRub)} за год` : ""}.`),
    para("Оплатить лучше заранее: годовой платёж проходит согласование у директора и бухгалтерии, а без оплаты в срок команда перейдёт на бесплатный тариф."),
    input.invoice
      ? para(`Счёт №${input.invoice.number} на ${rub(input.invoice.amountRub)} — во вложении, оплатить можно до ${input.invoice.dueLabel}. Новый год начнётся с даты окончания текущего — ни одного дня не пропадёт.`)
      : {
          html: `<p ${P}>Нужен счёт? Он сформируется на <a href="${input.requisitesUrl}" style="color:#3848c7">странице тарифа</a>, если указан ИНН. Новый год начнётся с даты окончания текущего.</p>`,
          text: `Нужен счёт? Он сформируется на странице тарифа, если указан ИНН: ${input.requisitesUrl}. Новый год начнётся с даты окончания текущего.`,
        },
    button("Продлить на год", input.payUrl),
    replyLine(input),
    signature(input.manager),
  ]);
  return {
    subject: `${org}: годовой тариф заканчивается ${input.lastDayLabel} — продлите заранее`,
    title: "Продлите заранее",
    ...body,
    telegramText: `📅 Год в WeSetup оплачен по ${escapeHtml(input.lastDayLabel)} — осталось ${days}. Лучше оплатить заранее: годовой платёж идёт через согласование.${input.invoice ? ` Счёт №${escapeHtml(input.invoice.number)} — на почте.` : ""}`,
  };
}
