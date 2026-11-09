/**
 * Тексты автоворонки: письма и Telegram клиенту, заголовки и описания задач
 * ответственному. Чистый модуль — данные на входе, строки на выходе; сервер
 * оборачивает HTML в фирменный шаблон письма.
 *
 * Правило честности как у биллинга: тем, кто не платил, не пишем «подписка
 * закончилась»; что отключится — только по фактическим цифрам аккаунта.
 */

import { pluralRu } from "@/lib/plural-ru";

import { dayLabel, weekdayLabel, type DayKey } from "./calendar";
import { CYCLE_NAMES, SEGMENT_LABELS, TIER_NAMES, type OfferSnapshot } from "./offer";
import { SCENARIO_LABELS, type MessagePlan, type TaskPlan } from "./planner";

const esc = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);

/** Название в кавычках: «Ромашка» — но «Кафе «Ромашка»» не кавычим второй раз. */
export function quoted(name: string): string {
  return /[«»"“”]/.test(name) ? name : `«${name}»`;
}

export function rub(value: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(value))} ₽`;
}

export const employees = (n: number) => `${n} ${pluralRu(n, "сотрудник", "сотрудника", "сотрудников")}`;
export const journals = (n: number) => `${n} ${pluralRu(n, "журнал", "журнала", "журналов")}`;
export const points = (n: number) => `${n} ${pluralRu(n, "точка", "точки", "точек")}`;
export const entries = (n: number) => `${n} ${pluralRu(n, "запись", "записи", "записей")}`;
export const days = (n: number) => `${n} ${pluralRu(n, "день", "дня", "дней")}`;

/** «через 4 дня — 20 ноября последний день», «завтра — последний день», «сегодня последний день». */
export function leftPhrase(daysLeft: number, lastDay: DayKey): string {
  if (daysLeft <= 0) return `сегодня, ${dayLabel(lastDay)}, последний день`;
  if (daysLeft === 1) return `завтра, ${dayLabel(lastDay)}, последний день`;
  return `через ${days(daysLeft)} — ${dayLabel(lastDay)} (${weekdayLabel(lastDay)}) последний день`;
}

export type ManagerSignature = { name: string; position: string | null; phone: string | null; email: string | null };

export type MessageContext = {
  orgName: string;
  recipientName: string | null;
  /** Счёт во вложении (или уже выставленный). */
  invoice: { number: string; amountRub: number; dueDay: DayKey } | null;
  /** Счёт хотели приложить, но у организации нет ИНН. */
  innMissing: boolean;
  manager: ManagerSignature | null;
  links: { pay: string; pricing: string; organization: string };
  /** Дней грейса после конца (для «что будет дальше»). */
  graceDays: number;
};

export type RenderedMessage = { subject: string; html: string; text: string; telegram: string };

const P = 'style="margin:0 0 14px;color:#3f3f46;line-height:1.6"';
const BOX = 'style="background:#f5f6ff;border-radius:8px;padding:14px 18px;margin:0 0 18px;color:#1f2a7a;line-height:1.6"';
const WARN = 'style="background:#fff8eb;border-radius:8px;padding:14px 18px;margin:0 0 18px;color:#7a4a00;line-height:1.6"';
const BUTTON =
  'style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px;margin:0 8px 8px 0"';
const GHOST =
  'style="display:inline-block;background:#fff;color:#3848c7;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px;border:1px solid #c9cff8;margin:0 8px 8px 0"';

/** Что отключится на бесплатном: «23 сотрудника уйдут в архив, 11 журналов выключатся». */
export function whatTurnsOff(offer: Pick<OfferSnapshot, "users" | "journals">): string | null {
  const parts: string[] = [];
  const archived = Math.max(0, offer.users - 1);
  const off = Math.max(0, offer.journals - 1);
  if (archived > 0) parts.push(`${employees(archived)} ${archived === 1 ? "уйдёт" : "уйдут"} в архив`);
  if (off > 0) parts.push(`${journals(off)} ${off === 1 ? "выключится" : "выключатся"}`);
  return parts.length ? parts.join(", ") : null;
}

/** ««Стандарт» на 2 точки: 47 760 ₽ за год — 3 980 ₽/мес». */
export function offerLine(offer: OfferSnapshot): string {
  const pointsPart = offer.points > 1 ? ` на ${points(offer.points)}` : "";
  const monthly = offer.cycle === "year" ? ` — ${rub(offer.monthlyRub)}/мес` : "";
  return `${TIER_NAMES[offer.tier]}${pointsPart}: ${rub(offer.amountRub)} ${CYCLE_NAMES[offer.cycle]}${monthly}`;
}

function usageLine(offer: OfferSnapshot): string {
  const parts = [employees(offer.users), journals(offer.journals)];
  if (offer.points > 1) parts.push(points(offer.points));
  const week = offer.entries7d > 0 ? `; за последнюю неделю — ${entries(offer.entries7d)}` : "";
  return `${parts.join(", ")}${week}`;
}

function signature(manager: ManagerSignature | null): { html: string; text: string } {
  if (!manager) return { html: `<p ${P}>Команда WeSetup</p>`, text: "Команда WeSetup" };
  const lines = [manager.name, manager.position, manager.phone, manager.email].filter((line): line is string => Boolean(line && line.trim()));
  return {
    html: `<p style="margin:18px 0 0;color:#3f3f46;line-height:1.5">${lines.map(esc).join("<br>")}<br><span style="color:#9b9fb3">WeSetup — электронные журналы ХАССП</span></p>`,
    text: [...lines, "WeSetup — электронные журналы ХАССП"].join("\n"),
  };
}

function invoiceBlock(ctx: MessageContext): { html: string; text: string } {
  if (ctx.invoice) {
    const line = `Счёт № ${ctx.invoice.number} на ${rub(ctx.invoice.amountRub)} — во вложении, действует до ${dayLabel(ctx.invoice.dueDay)}.`;
    return { html: `<p ${P}><strong>${esc(line)}</strong></p>`, text: line };
  }
  if (ctx.innMissing) {
    const line = "Чтобы выставить счёт на организацию, укажите ИНН в «Настройки → Организация» — счёт сформируется сразу. Или оплатите картой.";
    return { html: `<p ${P}>${esc(line)} <a href="${ctx.links.organization}" style="color:#3848c7">Указать ИНН</a></p>`, text: line };
  }
  return { html: "", text: "" };
}

function hello(ctx: MessageContext): string {
  return ctx.recipientName ? `Здравствуйте, ${ctx.recipientName}!` : "Здравствуйте!";
}

function compose(subject: string, blocks: { html: string; text: string }[], telegram: string): RenderedMessage {
  const html = blocks.map((block) => block.html).filter(Boolean).join("");
  const text = blocks.map((block) => block.text).filter(Boolean).join("\n\n");
  return { subject, html, text, telegram };
}

const para = (text: string, style = P) => ({ html: `<p ${style}>${esc(text)}</p>`, text });
const box = (text: string, style = BOX) => ({ html: `<div ${style}>${esc(text)}</div>`, text });

function buttons(ctx: MessageContext, withPricing = true): { html: string; text: string } {
  const html =
    `<p style="margin:0 0 6px"><a href="${ctx.links.pay}" ${BUTTON}>Оплатить</a>` +
    (withPricing ? `<a href="${ctx.links.pricing}" ${GHOST}>Все тарифы</a>` : "") +
    "</p>";
  return { html, text: `Оплатить: ${ctx.links.pay}${withPricing ? `\nВсе тарифы: ${ctx.links.pricing}` : ""}` };
}

const ADVANCE =
  "Оплатить лучше заранее: бухгалтерии и директору нужно время на согласование, а в выходные платежи не проходят.";

/** Письмо клиенту по ступени автоворонки. */
export function renderClientMessage(message: MessagePlan, ctx: MessageContext): RenderedMessage {
  const { offer } = message;
  const org = ctx.orgName;
  const q = quoted(org);
  const sig = signature(ctx.manager);
  const reply = para(
    ctx.manager
      ? "Нужен другой состав, договор или условия для сети — просто ответьте на это письмо, я помогу."
      : "Нужен другой состав, договор или условия для сети — ответьте на это письмо, поможем.",
  );
  const turnsOff = whatTurnsOff(offer);

  if (message.scenario === "trial") {
    const when = leftPhrase(message.daysLeft, message.lastDay);
    if (message.segment === "fits_free") {
      return compose(
        `${q}: пробный период до ${dayLabel(message.lastDay)}`,
        [
          para(hello(ctx)),
          para(`Пробный период WeSetup для ${q} заканчивается ${when}.`),
          box("У вас 1 сотрудник и 1 журнал — после пробного всё останется как есть на бесплатном тарифе. Ничего делать не нужно."),
          para(`Когда понадобится команда или все журналы — подключите тариф ${offerLine(offer)}.`),
          buttons(ctx, true),
          sig,
        ],
        `ℹ️ Пробный период ${q} заканчивается ${when}. У вас 1 сотрудник и 1 журнал — всё останется на бесплатном тарифе.`,
      );
    }
    if (message.segment === "idle") {
      return compose(
        `${q}: пробный период до ${dayLabel(message.lastDay)} — продлить?`,
        [
          para(hello(ctx)),
          para(`Пробный период WeSetup для ${q} заканчивается ${when}.`),
          box("Похоже, журналы ещё не начали вести. Если не успели попробовать — ответьте на это письмо: продлим пробный период и поможем всё настроить за 15 минут."),
          para(`После пробного на бесплатном тарифе останется 1 сотрудник и 1 журнал${turnsOff ? `: ${turnsOff}` : ""}. Записи сохранятся.`),
          buttons(ctx, true),
          sig,
        ],
        `⏳ Пробный период ${q} заканчивается ${when}. Не успели попробовать? Ответьте менеджеру — продлим пробный и поможем настроить.`,
      );
    }
    const short = message.stage <= 2;
    const blocks = [
      para(hello(ctx)),
      para(`Пробный период WeSetup для ${q} заканчивается ${when}.`),
      box(`Сейчас у вас: ${usageLine(offer)}.`),
      para(
        `Если не подключить тариф, после ${dayLabel(message.lastDay)} будет ${days(ctx.graceDays)} на решение, а затем на бесплатном тарифе останется 1 сотрудник и 1 журнал` +
          (turnsOff ? `: ${turnsOff}` : "") +
          ". Записи сохранятся, всё вернётся после оплаты.",
        short ? WARN : P,
      ),
      box(`Вам подходит ${offerLine(offer)}${offer.cycle === "year" && offer.yearSavingRub > 0 ? ` (выгоднее помесячной оплаты на ${rub(offer.yearSavingRub)})` : ""}.${offer.reasons.length ? ` Почему: ${offer.reasons.join("; ")}.` : ""}`),
      invoiceBlock(ctx),
      para(ADVANCE),
      buttons(ctx),
      reply,
      sig,
    ];
    return compose(
      short ? `${q}: пробный период заканчивается ${dayLabel(message.lastDay)}` : `${q}: пробный период до ${dayLabel(message.lastDay)} — что изменится`,
      blocks,
      `⏳ Пробный период ${q} заканчивается ${when}. Сейчас: ${usageLine(offer)}. Без тарифа${turnsOff ? ` ${turnsOff}` : " останется 1 сотрудник и 1 журнал"}. ` +
        `Подходит ${offerLine(offer)}.${ctx.invoice ? ` Счёт № ${ctx.invoice.number} отправили на почту.` : ""}`,
    );
  }

  if (message.scenario === "grace_last") {
    const graceDay = message.graceLastDay ?? message.lastDay;
    const ended = message.dealKind === "renewal" ? "Оплаченный период закончился" : "Пробный период закончился";
    const tail = turnsOff ? `${turnsOff}` : "останутся владелец и один журнал";
    return compose(
      `${q}: ${dayLabel(graceDay)} — последний день до перехода на бесплатный`,
      [
        para(hello(ctx)),
        para(`${ended} ${dayLabel(message.lastDay)}, тариф пока не подключён.`),
        box(
          `${dayLabel(graceDay)} (${weekdayLabel(graceDay)}) — последний день. Потом ${q} перейдёт на бесплатный тариф: в работе останутся владелец и самый заполняемый журнал, ${tail}. Записи сохранятся.`,
          WARN,
        ),
        message.segment === "idle" ? para("Если сервис пока не нужен — ничего делать не надо. Если нужно больше времени — ответьте на письмо.") : box(`Чтобы всё осталось как есть: ${offerLine(offer)}.`),
        invoiceBlock(ctx),
        buttons(ctx),
        reply,
        sig,
      ],
      `⚠️ ${q}: ${dayLabel(graceDay)} — последний день. Потом бесплатный тариф: ${tail}. Чтобы всё осталось: ${offerLine(offer)}.`,
    );
  }

  // Продление.
  const when = leftPhrase(message.daysLeft, message.lastDay);
  const pointsPart = offer.points > 1 ? `, ${points(offer.points)}` : "";
  const current = `${TIER_NAMES[offer.tier]}${pointsPart}, ${offer.cycle === "year" ? "оплата за год" : "помесячно"}`;
  const early = message.stage >= 7;
  const switchYear =
    offer.cycle === "month" && offer.yearSavingRub > 0
      ? box(`Перейдите на оплату за год — выйдет на ${rub(offer.yearSavingRub)} дешевле, чем 12 помесячных оплат, и счёт один раз в год.`)
      : { html: "", text: "" };
  const lastDayNotice = message.stage <= 1;
  return compose(
    lastDayNotice
      ? `${q}: ${message.daysLeft <= 0 ? "сегодня" : "завтра"} последний оплаченный день`
      : early
        ? `${q}: оплата до ${dayLabel(message.lastDay)} — продлите заранее`
        : `${q}: оплата заканчивается ${dayLabel(message.lastDay)}`,
    [
      para(hello(ctx)),
      para(`Оплаченный период ${q} (${current}) заканчивается ${when}.`),
      early ? para("Напоминаем заранее, чтобы счёт успели провести и доступ команды не прервался. Новый период прибавится к текущему — оплаченные дни не пропадут.") : para(ADVANCE),
      box(`Продление: ${offerLine(offer)}.`),
      switchYear,
      invoiceBlock(ctx),
      ctx.graceDays > 0 && !early
        ? para(`Если не продлить, после окончания будет ${days(ctx.graceDays)} на оплату, потом в работе останутся владелец и один журнал${turnsOff ? `: ${turnsOff}` : ""}.`)
        : { html: "", text: "" },
      buttons(ctx, false),
      reply,
      sig,
    ],
    `${lastDayNotice ? "⚠️" : "⏳"} Оплата ${q} заканчивается ${when}. Продление: ${offerLine(offer)}.${ctx.invoice ? ` Счёт № ${ctx.invoice.number} отправили на почту.` : ""}`,
  );
}

// ---------------------------------------------------------------- задачи

export type TaskContext = {
  orgName: string;
  /** Как связаться: что есть у владельца аккаунта. */
  contact: { name: string | null; phone: string | null; telegram: boolean; email: string | null };
  /** Письмо этой ступени ушло (или уйдёт) клиенту. */
  messageSent: boolean;
  invoice: { number: string; amountRub: number } | null;
  hasInn: boolean;
};

export type TaskCopy = { title: string; body: string };

function offerAdvice(task: TaskPlan): string[] {
  const offer = task.offer;
  if (!offer) return [];
  const lines = [`Что предложить: ${offerLine(offer)}.`];
  if (offer.reasons.length) lines.push(`Почему: ${offer.reasons.join("; ")}.`);
  if (offer.discountPercent > 0) {
    const price = `${rub(offer.amountRub)} → ${rub(offer.discountedRub)}`;
    lines.push(
      task.approval.needed
        ? `Скидка по лестнице — ${offer.discountPercent} % (${price}). Больше вашего лимита ${task.approval.limit} % — отправьте на согласование («Отправить КП со скидкой»).`
        : `Можно дать скидку ${offer.discountPercent} % (${price}) — в пределах вашего лимита: «Отправить КП со скидкой».`,
    );
  } else if (offer.segment === "team" || offer.segment === "solo") {
    lines.push("Скидка по лестнице не положена — предложите оплату за год (выгоднее помесячной).");
  }
  return lines;
}

function usageFacts(task: TaskPlan): string | null {
  const offer = task.offer;
  if (!offer) return null;
  return `По аккаунту: ${employees(offer.users)}, ${journals(offer.journals)}, ${points(offer.points)}; записей за неделю — ${offer.entries7d}; ${SEGMENT_LABELS[offer.segment]}.`;
}

function contactLine(ctx: TaskContext): string {
  const ways = [
    ctx.contact.phone ? `телефон ${ctx.contact.phone}` : null,
    ctx.contact.telegram ? "Telegram привязан (бот)" : null,
    ctx.contact.email ? `почта ${ctx.contact.email}` : null,
  ].filter(Boolean);
  return `Как связаться: ${ways.length ? ways.join(", ") : "контактов нет — только через кабинет"}${ctx.contact.name ? ` (${ctx.contact.name})` : ""}.`;
}

/** Заголовок и описание задачи ответственному. */
export function renderTaskCopy(task: TaskPlan, ctx: TaskContext): TaskCopy {
  const org = quoted(ctx.orgName);
  const lines: string[] = [];
  const facts = usageFacts(task);
  const until = task.lastDay ? dayLabel(task.lastDay) : null;
  let title: string;
  switch (task.scenario) {
    case "welcome":
      title = `Познакомиться с новым клиентом ${org}`;
      lines.push("Зарегистрировались на пробный период. Позвоните: узнайте, сколько точек и сотрудников, когда проверка, как ведут журналы сейчас; помогите настроить и пригласить команду.");
      break;
    case "activation":
      title = `${org} не начали вести журналы — помочь запустить`;
      lines.push(`Пробный идёт уже несколько дней, записей в журналах нет${until ? `; пробный по ${until}` : ""}. Предложите 15-минутную настройку, помогите пригласить сотрудников и включить нужные журналы.`);
      break;
    case "trial":
      if (task.segment === "idle") {
        title = `Пробный ${org} до ${until}: не пользуются — узнать, продлить пробный?`;
        lines.push("Журналы не ведут. Узнайте, что помешало; если интерес есть — продлите пробный (карточка клиента → «Пробный период») и помогите запустить.");
      } else {
        title = `Пробный ${org} до ${until}: ${task.stage && task.stage <= 2 ? "повторный контакт" : "позвонить, предложить тариф"}`;
        lines.push(
          `Пробный заканчивается ${leftPhrase(task.daysLeft ?? 0, task.lastDay ?? "")}. ${ctx.messageSent ? "Письмо с расчётом" + (ctx.invoice ? " и счётом" : "") + " клиенту ушло — " : ""}позвоните или напишите в мессенджер: подтвердите, что письмо дошло, ответьте на вопросы, договоритесь о дате оплаты (B2B: счёт согласует директор, учтите выходные).`,
        );
      }
      break;
    case "grace_start":
      title = `${org}: ${task.dealKind === "renewal" ? "оплата закончилась" : "пробный закончился"}, не оплачено — до ${task.graceLastDay ? dayLabel(task.graceLastDay) : "конца грейса"}`;
      lines.push(`Тариф не выбран. До ${task.graceLastDay ? dayLabel(task.graceLastDay) : "конца грейса"} включительно всё работает, потом автопереход на бесплатный. Узнайте, что мешает оплате, и договоритесь о сроке.`);
      break;
    case "grace_last": {
      const off = task.offer ? whatTurnsOff(task.offer) : null;
      title = `Срочно: ${org} — ${task.graceLastDay ? dayLabel(task.graceLastDay) : "скоро"} последний день${off ? `, потом ${off}` : ""}`;
      lines.push(`${ctx.messageSent ? "Клиенту ушло последнее предупреждение. " : ""}Последний звонок до автоперехода на бесплатный: подтвердите оплату или договоритесь о продлении грейса (карточка клиента).`);
      break;
    }
    case "renewal":
      title = `Продление ${org}: оплата до ${until}`;
      lines.push(
        `Оплаченный срок заканчивается ${leftPhrase(task.daysLeft ?? 0, task.lastDay ?? "")}. ${ctx.messageSent ? "Напоминание" + (ctx.invoice ? " со счётом" : "") + " ушло клиенту. " : ""}Позвоните: подтвердите продление и дату оплаты${task.offer?.cycle === "month" ? ", предложите перейти на оплату за год" : ""}.`,
      );
      break;
    case "invoice_unpaid":
      title = `Счёт № ${task.invoice?.id} ${org} на ${rub(task.invoice?.amountRub ?? 0)} не оплачен — уточнить`;
      lines.push("Клиент сам выставил счёт, оплаты нет уже 2 рабочих дня. Уточните у бухгалтерии или директора, когда оплатят; при необходимости пришлите закрывающие документы или договор.");
      break;
    case "invoice_expired":
      title = `Счёт № ${task.invoice?.id} ${org} истёк — выставить новый`;
      lines.push("Срок счёта прошёл, новой оплаты нет. Выставьте новый счёт из карточки клиента и отправьте с напоминанием.");
      break;
    case "card_abandoned":
      title = `${org} начали оплату картой и не завершили`;
      lines.push(`Заказ № ${task.card?.id} на ${rub(task.card?.amountRub ?? 0)} не оплачен. Предложите помощь: оплату по счёту для юрлица, другой тариф, ответы на вопросы.`);
      break;
    case "winback":
      title = `${org} ушли на бесплатный — узнать причину, предложить вернуться`;
      lines.push("Аккаунт перешёл на бесплатный тариф. Узнайте причину (цена, неудобно, не нужно сейчас) и, если уместно, предложите спец-условия.");
      break;
  }
  if (facts) lines.push(facts);
  if (!["invoice_unpaid", "invoice_expired", "card_abandoned", "welcome", "activation"].includes(task.scenario)) lines.push(...offerAdvice(task));
  if ((task.scenario === "trial" || task.scenario === "grace_last" || task.scenario === "grace_start") && !ctx.hasInn && task.segment !== "idle") {
    lines.push("ИНН в организации не указан — счёт автоматически не выставился: попросите реквизиты.");
  }
  lines.push(contactLine(ctx));
  lines.push(`Сценарий: ${SCENARIO_LABELS[task.scenario]}${task.stage ? `, за ${days(task.stage)}` : ""}.`);
  return { title: title.slice(0, 200), body: lines.join("\n") };
}
