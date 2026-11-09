/**
 * Эмулятор автоворонки CRM: гоняет планировщик (`src/lib/crm/lifecycle/planner.ts`)
 * по часам для типовых клиентов и печатает ленту — что получил клиент, какие
 * задачи появились у менеджера, куда двинулась сделка. Без базы и почты.
 *
 *   npx tsx scripts/crm-lifecycle-simulate.ts [--out файл.md] [--persona ключ]
 */
import { writeFileSync } from "node:fs";

import { atMsk, mskDay, mskHour } from "../src/lib/crm/lifecycle/calendar";
import { renderClientMessage, renderTaskCopy } from "../src/lib/crm/lifecycle/copy";
import type { UsageSnapshot } from "../src/lib/crm/lifecycle/offer";
import { planLifecycle, STAGE_SCENARIOS, type DealView, type PendingInvoice, type UnitSnapshot } from "../src/lib/crm/lifecycle/planner";
import { DEFAULT_LIFECYCLE_SETTINGS } from "../src/lib/crm/lifecycle/settings";
import { DEAL_STAGE_SHORT, advanceStage } from "../src/lib/crm/lifecycle/stages";
import { DEFAULT_PLAN_RATES } from "../src/lib/tariff-plans";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const GRACE_DAYS = 7;

type Phase = { kind: UnitSnapshot["billing"]["kind"]; billing?: Partial<UnitSnapshot["billing"]>; usage?: Partial<UsageSnapshot> };

type Persona = {
  key: string;
  title: string;
  story: string;
  created: Date;
  usage: UsageSnapshot;
  hasInn: boolean;
  phone: boolean;
  /** Оплаченный срок на старте (продление). */
  paid?: { tier: "standard" | "premium"; cycle: "year" | "month"; points: number; until: Date };
  /** События по времени: оплата, переход на бесплатный, счёт, брошенная карта, договор. */
  events: { at: Date; label: string; apply: (state: SimState) => void }[];
  until: Date;
};

type SimState = {
  phase: Phase;
  invoices: PendingInvoice[];
  card: UnitSnapshot["abandonedCard"];
  contractSignedAt: Date | null;
  usage: UsageSnapshot;
};

function usage(patch: Partial<UsageSnapshot>): UsageSnapshot {
  return { activeUsers: 1, enabledJournals: 30, pointsInUse: 1, entries7d: 0, entries14d: 0, journalsUsed14d: 0, lastEntryAt: null, devices: 0, ...patch };
}

const trialEnd = (created: Date) => new Date(created.getTime() + 14 * DAY);

function paidFrom(at: Date, cycle: "year" | "month", tier: "standard" | "premium" = "standard", points = 1): Phase {
  const until = new Date(at.getTime() + (cycle === "year" ? 365 : 30) * DAY);
  return { kind: "paid", billing: { paidTier: tier, planCycle: cycle, planPoints: points, paidUntil: until, subscriptionEnd: until } };
}

const C1 = atMsk("2026-11-02", 9, 40);
const C2 = atMsk("2026-11-03", 14, 0);
const C3 = atMsk("2026-11-02", 22, 0);
const C4 = atMsk("2026-11-05", 11, 0);
const C5 = atMsk("2026-11-06", 16, 0);
const C8 = atMsk("2026-11-09", 10, 0);
const C9 = atMsk("2026-11-04", 12, 0);
const R6 = atMsk("2026-12-22", 0);
const R7 = atMsk("2026-11-20", 0);

const PERSONAS: Persona[] = [
  {
    key: "romashka",
    title: "Кафе «Ромашка» — команда 24 человека, 2 точки, ИНН есть",
    story: "Ведут журналы каждый день. Получают письмо со счётом за 4 дня, менеджер звонит, договор подписан в ЭДО, платят за день до конца пробного.",
    created: C1,
    usage: usage({ activeUsers: 24, enabledJournals: 12, pointsInUse: 2, entries7d: 340, entries14d: 600, journalsUsed14d: 9, lastEntryAt: C1 }),
    hasInn: true,
    phone: true,
    events: [
      { at: atMsk("2026-11-13", 15), label: "договор подписан в ЭДО", apply: (s) => (s.contractSignedAt = atMsk("2026-11-13", 15)) },
      { at: atMsk("2026-11-15", 12), label: "оплатили счёт (Стандарт, год, 2 точки)", apply: (s) => (s.phase = paidFrom(atMsk("2026-11-15", 12), "year", "standard", 2)) },
    ],
    until: atMsk("2026-11-25", 12),
  },
  {
    key: "stolovaya",
    title: "Столовая комбината — 140 сотрудников, 4 точки",
    story: "Крупный клиент: рекомендован «Премиум», супер-скидка 25 % — выше лимита РОП, нужно согласование. Не успели к концу пробного, оплатили в грейс.",
    created: C2,
    usage: usage({ activeUsers: 140, enabledJournals: 20, pointsInUse: 4, entries7d: 2100, entries14d: 3900, journalsUsed14d: 15, lastEntryAt: C2 }),
    hasInn: true,
    phone: true,
    events: [
      {
        at: trialEnd(C2),
        label: "пробный кончился — грейс 7 дней",
        apply: (s) => (s.phase = { kind: "needs_decision", billing: { reason: "trial_ended", graceEndsAt: new Date(trialEnd(C2).getTime() + GRACE_DAYS * DAY) } }),
      },
      { at: atMsk("2026-11-22", 13), label: "оплатили «Премиум» на год со скидкой", apply: (s) => (s.phase = paidFrom(atMsk("2026-11-22", 13), "year", "premium", 4)) },
    ],
    until: atMsk("2026-11-28", 12),
  },
  {
    key: "pekarnya",
    title: "Пекарня «Хлеб» — зарегистрировались и не начали",
    story: "Журналы не ведут: задача «помочь запустить» на 4-й день, письма без счёта с предложением продлить пробный, потом автопереход — отказ без задачи «вернуть».",
    created: C3,
    usage: usage({ activeUsers: 2, enabledJournals: 30 }),
    hasInn: false,
    phone: false,
    events: [
      { at: trialEnd(C3), label: "пробный кончился — грейс", apply: (s) => (s.phase = { kind: "needs_decision", billing: { reason: "trial_ended", graceEndsAt: new Date(trialEnd(C3).getTime() + GRACE_DAYS * DAY) } }) },
      { at: new Date(trialEnd(C3).getTime() + GRACE_DAYS * DAY + HOUR), label: "автопереход на бесплатный", apply: (s) => ((s.phase = { kind: "free", billing: { reason: "trial_ended" } }), (s.usage = { ...s.usage, activeUsers: 1, enabledJournals: 1 })) },
    ],
    until: atMsk("2026-11-28", 12),
  },
  {
    key: "petrov",
    title: "ИП Петров — ведёт один, ИНН не указан",
    story: "Один пользователь: одна задача за 4 дня, в письмах — «укажите ИНН». Не платит → бесплатный → задача «вернуть».",
    created: C4,
    usage: usage({ activeUsers: 1, enabledJournals: 8, entries7d: 40, entries14d: 60, journalsUsed14d: 3, lastEntryAt: C4 }),
    hasInn: false,
    phone: true,
    events: [
      { at: trialEnd(C4), label: "пробный кончился — грейс", apply: (s) => (s.phase = { kind: "needs_decision", billing: { reason: "trial_ended", graceEndsAt: new Date(trialEnd(C4).getTime() + GRACE_DAYS * DAY) } }) },
      { at: new Date(trialEnd(C4).getTime() + GRACE_DAYS * DAY + HOUR), label: "автопереход на бесплатный", apply: (s) => ((s.phase = { kind: "free", billing: { reason: "trial_ended" } }), (s.usage = { ...s.usage, activeUsers: 1, enabledJournals: 1 })) },
    ],
    until: atMsk("2026-12-05", 12),
  },
  {
    key: "barista",
    title: "Кофейня «Бариста» — 1 сотрудник, 1 журнал",
    story: "В пределах бесплатного: одно короткое письмо «ничего не изменится», задач нет, после пробного — тихо бесплатный.",
    created: C5,
    usage: usage({ activeUsers: 1, enabledJournals: 1, entries7d: 14, entries14d: 20, journalsUsed14d: 1, lastEntryAt: C5 }),
    hasInn: false,
    phone: true,
    events: [{ at: trialEnd(C5), label: "тихий переход на бесплатный", apply: (s) => (s.phase = { kind: "free", billing: { reason: "trial_ended" } }) }],
    until: atMsk("2026-11-26", 12),
  },
  {
    key: "set",
    title: "Сеть «Вкусно рядом» — оплачено за год, продление",
    story: "Годовая оплата до 21 декабря: письма за 30 и 14 дней со счётом на продление, за 4 и 2 дня — задачи, оплатили за 2 дня.",
    created: atMsk("2025-12-01", 10),
    usage: usage({ activeUsers: 60, enabledJournals: 18, pointsInUse: 3, entries7d: 900, entries14d: 1700, journalsUsed14d: 14, lastEntryAt: atMsk("2026-11-20", 9) }),
    hasInn: true,
    phone: true,
    paid: { tier: "standard", cycle: "year", points: 3, until: R6 },
    events: [{ at: atMsk("2026-12-18", 16), label: "оплатили продление на год", apply: (s) => (s.phase = paidFrom(R6, "year", "standard", 3)) }],
    until: atMsk("2026-12-25", 12),
  },
  {
    key: "shaurma",
    title: "«Шаурма Экспресс» — помесячно, не продлили",
    story: "Помесячная оплата до 19 ноября: письма за 7/4/2/1 день, задачи; не платят → грейс → последний шанс → бесплатный → «вернуть».",
    created: atMsk("2026-08-01", 10),
    usage: usage({ activeUsers: 6, enabledJournals: 10, entries7d: 120, entries14d: 230, journalsUsed14d: 6, lastEntryAt: atMsk("2026-11-10", 9) }),
    hasInn: true,
    phone: true,
    paid: { tier: "standard", cycle: "month", points: 1, until: R7 },
    events: [
      {
        at: R7,
        label: "оплата кончилась — грейс",
        apply: (s) => (s.phase = { kind: "needs_decision", billing: { reason: "subscription_expired", subscriptionEnd: R7, paidUntil: null, paidTier: null, graceEndsAt: new Date(R7.getTime() + GRACE_DAYS * DAY) } }),
      },
      { at: new Date(R7.getTime() + GRACE_DAYS * DAY + HOUR), label: "автопереход на бесплатный", apply: (s) => ((s.phase = { kind: "free", billing: { reason: "subscription_expired" } }), (s.usage = { ...s.usage, activeUsers: 1, enabledJournals: 1 })) },
    ],
    until: atMsk("2026-12-03", 12),
  },
  {
    key: "ceh",
    title: "Цех полуфабрикатов — сами выставили счёт и бросили оплату картой",
    story: "Счёт по ИНН не оплачен 2 рабочих дня — задача; счёт истёк — задача; брошенная оплата картой — задача.",
    created: C8,
    usage: usage({ activeUsers: 12, enabledJournals: 14, entries7d: 200, entries14d: 260, journalsUsed14d: 8, lastEntryAt: C8 }),
    hasInn: true,
    phone: true,
    events: [
      { at: atMsk("2026-11-10", 15), label: "клиент выставил счёт № 9001 (до 17 ноября)", apply: (s) => s.invoices.push({ id: 9001, createdAt: atMsk("2026-11-10", 15), dueAt: atMsk("2026-11-17", 15), amountRub: 23880, auto: false }) },
      { at: atMsk("2026-11-18", 11), label: "начали оплату картой № 9002 и бросили", apply: (s) => (s.card = { id: 9002, createdAt: atMsk("2026-11-18", 11), amountRub: 2990 }) },
      { at: atMsk("2026-11-19", 11), label: "оплатили картой", apply: (s) => ((s.phase = paidFrom(atMsk("2026-11-19", 11), "month")), (s.card = null), (s.invoices = [])) },
    ],
    until: atMsk("2026-11-21", 12),
  },
  {
    key: "praznik",
    title: "Кафе у вокзала — конец пробного после праздника 4 ноября и выходных",
    story: "Пробный по 18 ноября (среда): ступени не попадают на выходные; задача «познакомиться» ставится на рабочий день после регистрации 4 ноября (праздник).",
    created: C9,
    usage: usage({ activeUsers: 5, enabledJournals: 9, entries7d: 70, entries14d: 90, journalsUsed14d: 5, lastEntryAt: C9 }),
    hasInn: true,
    phone: true,
    events: [{ at: atMsk("2026-11-17", 10), label: "оплатили картой", apply: (s) => (s.phase = paidFrom(atMsk("2026-11-17", 10), "month")) }],
    until: atMsk("2026-11-20", 12),
  },
];

function fmt(date: Date): string {
  const day = mskDay(date);
  const weekday = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"][new Date(`${day}T00:00:00Z`).getUTCDay()];
  return `${day.slice(8, 10)}.${day.slice(5, 7)} ${weekday} ${String(mskHour(date)).padStart(2, "0")}:${String(new Date(date.getTime() + 3 * HOUR).getUTCMinutes()).padStart(2, "0")}`;
}

function simulate(persona: Persona): string[] {
  const lines: string[] = [`## ${persona.title}`, "", persona.story, ""];
  const state: SimState = {
    phase: persona.paid
      ? { kind: "paid", billing: { paidTier: persona.paid.tier, planCycle: persona.paid.cycle, planPoints: persona.paid.points, paidUntil: persona.paid.until, subscriptionEnd: persona.paid.until } }
      : { kind: "free_period" },
    invoices: [],
    card: null,
    contractSignedAt: null,
    usage: persona.usage,
  };
  const deals = new Map<string, DealView>();
  const done = new Set<string>();
  const openTasks = new Map<string, { title: string; dealKey: string | null; scenario: string }>();
  const events = [...persona.events].sort((a, b) => a.at.getTime() - b.at.getTime());
  let autoInvoice = 7000;
  const start = new Date(Math.max(persona.created.getTime(), (persona.paid?.until.getTime() ?? 0) - 35 * DAY));
  for (let now = new Date(start.getTime() + 5 * 60 * 1000); now <= persona.until; now = new Date(now.getTime() + HOUR)) {
    while (events.length && events[0].at <= now) {
      const event = events.shift()!;
      event.apply(state);
      lines.push(`- \`${fmt(event.at)}\` **событие:** ${event.label}`);
    }
    const unit: UnitSnapshot = {
      unitKey: persona.key,
      organizationId: persona.key,
      organizationName: persona.title.split(" — ")[0].replace(/^[^«]*«|»$/g, "") || persona.key,
      accountCreatedAt: persona.created,
      enforcement: true,
      billing: {
        kind: state.phase.kind,
        inactive: false,
        paidTier: null,
        planCycle: "month",
        planPoints: 1,
        paidUntil: null,
        subscriptionEnd: null,
        trialEndsAt: trialEnd(persona.created),
        graceEndsAt: null,
        reason: null,
        ...state.phase.billing,
      },
      usage: state.usage,
      owner: { phone: persona.phone, telegram: false, email: true },
      hasInn: persona.hasInn,
      contractSignedAt: state.contractSignedAt,
      invoices: state.invoices,
      abandonedCard: state.card,
    };
    const plan = planLifecycle({ unit, deals: [...deals.values()], done, now, settings: DEFAULT_LIFECYCLE_SETTINGS, rates: DEFAULT_PLAN_RATES, assigneeLimit: 15 });
    const stamp = `\`${fmt(now)}\``;
    for (const won of plan.won) {
      const deal = deals.get(won.dealKey);
      if (!deal) continue;
      deal.stage = "won";
      lines.push(`- ${stamp} сделка → **${DEAL_STAGE_SHORT.won}** (${won.reason})`);
      for (const [key, task] of openTasks) if (task.dealKey === won.dealKey) (openTasks.delete(key), lines.push(`  - задача закрыта «Оплачено»: ${task.title}`));
    }
    for (const lost of plan.lost) {
      const deal = deals.get(lost.dealKey);
      if (!deal) continue;
      deal.stage = "lost";
      lines.push(`- ${stamp} сделка → **${DEAL_STAGE_SHORT.lost}** (${lost.reason})`);
      for (const [key, task] of openTasks) if (task.dealKey === lost.dealKey && STAGE_SCENARIOS.has(task.scenario)) (openTasks.delete(key), lines.push(`  - задача закрыта «Неактуально»: ${task.title}`));
    }
    if (plan.deal) {
      const existing = deals.get(plan.deal.key);
      if (!existing) {
        deals.set(plan.deal.key, { id: plan.deal.key, dedupeKey: plan.deal.key, kind: plan.deal.kind, stage: "registered", stageManual: false, periodEnd: plan.deal.periodEnd, offer: plan.deal.offer, contractSignedAt: null });
        lines.push(`- ${stamp} сделка «${plan.deal.kind === "trial" ? "новый клиент" : "продление"}» → **${DEAL_STAGE_SHORT.registered}**`);
      } else {
        existing.offer = plan.deal.offer;
        existing.periodEnd = plan.deal.periodEnd;
      }
    }
    for (const change of plan.stageChanges) {
      const deal = deals.get(change.dealKey);
      if (deal) (deal.stage = change.to), lines.push(`- ${stamp} сделка → **${DEAL_STAGE_SHORT[change.to]}** (${change.reason})`);
    }
    for (const message of plan.messages) {
      done.add(message.key);
      const invoice = message.attachInvoice ? { number: String((autoInvoice += 1)), amountRub: message.offer.amountRub, dueDay: mskDay(new Date(now.getTime() + 7 * DAY)) } : null;
      if (invoice) state.invoices.push({ id: Number(invoice.number), createdAt: now, dueAt: new Date(now.getTime() + 7 * DAY), amountRub: invoice.amountRub, auto: true });
      const rendered = renderClientMessage(message, {
        orgName: unit.organizationName,
        recipientName: null,
        invoice,
        innMissing: !unit.hasInn && (message.segment === "team" || message.segment === "solo"),
        manager: { name: "Алексей", position: "Коммерческий директор", phone: null, email: "alexey@wesetup.ru" },
        links: { pay: "https://wesetup.ru/settings/subscription", pricing: "https://wesetup.ru/pricing", organization: "https://wesetup.ru/settings/organization" },
        graceDays: GRACE_DAYS,
      });
      lines.push(`- ${stamp} ✉️ клиенту: **${rendered.subject}**${invoice ? ` + счёт № ${invoice.number} PDF` : ""}`);
      const deal = deals.get(message.dealKey);
      if (deal) {
        const to = advanceStage(deal, "message_sent");
        if (to) (deal.stage = to), lines.push(`  - сделка → **${DEAL_STAGE_SHORT[to]}**`);
      }
    }
    for (const task of plan.tasks) {
      done.add(task.key);
      if (task.supersede) {
        for (const [key, open] of openTasks) {
          if (open.dealKey === task.dealKey && STAGE_SCENARIOS.has(open.scenario)) (openTasks.delete(key), lines.push(`  - прежняя задача закрыта «Заменена новой»: ${open.title}`));
        }
      }
      const copy = renderTaskCopy(task, {
        orgName: unit.organizationName,
        contact: { name: null, phone: persona.phone ? "+7 900 000-00-00" : null, telegram: false, email: "owner@client.ru" },
        messageSent: Boolean(task.messageKey && done.has(task.messageKey)),
        invoice: null,
        hasInn: unit.hasInn,
      });
      openTasks.set(task.key, { title: copy.title, dealKey: task.dealKey, scenario: task.scenario });
      const approval = task.approval.needed ? ` — **скидка ${task.offer?.discountPercent} % на согласование**` : task.offer?.discountPercent ? ` — скидка ${task.offer.discountPercent} %` : "";
      lines.push(`- ${stamp} 📋 задача Алексею (срок ${fmt(task.dueAt)}): **${copy.title}**${approval}`);
      // Менеджер выполняет задачу ступени: позвонил — сделка «Был прозвон».
      if (task.kind === "call" && task.scenario !== "welcome" && task.dealKey) {
        const deal = deals.get(task.dealKey);
        if (deal) {
          const to = advanceStage(deal, "called");
          if (to) (deal.stage = to), lines.push(`  - менеджер позвонил → сделка **${DEAL_STAGE_SHORT[to]}**`);
        }
      }
    }
  }
  const finalDeals = [...deals.values()].map((deal) => `${deal.kind === "trial" ? "новый клиент" : "продление"}: ${DEAL_STAGE_SHORT[deal.stage as keyof typeof DEAL_STAGE_SHORT] ?? deal.stage}`);
  lines.push("", `Итог: ${finalDeals.join("; ") || "сделок нет"}; открытых задач: ${openTasks.size}.`, "");
  return lines;
}

const args = process.argv.slice(2);
const only = args.includes("--persona") ? args[args.indexOf("--persona") + 1] : null;
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const report = [
  "# Эмуляция автоворонки CRM",
  "",
  "Планировщик гоняется по часам; время — московское. Менеджер (лимит скидки 15 %) выполняет задачи-звонки сразу. Счета автоворонки — номера 7001+.",
  "",
  ...PERSONAS.filter((persona) => !only || persona.key === only).flatMap(simulate),
].join("\n");
if (out) writeFileSync(out, `${report}\n`);
console.log(report);
