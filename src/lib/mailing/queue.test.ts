import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { overallRecipientStatus, type ChannelStatus, type MailingChannel, type RecipientStatus } from "@/lib/mailing/labels";
import {
  MAX_ATTEMPTS,
  deliverRecipient,
  runQueuePass,
  type ChannelSenders,
  type MailingQueueStore,
  type OutgoingEmail,
  type QueueCampaign,
  type QueueDeps,
  type QueueRecipient,
  type RecipientPatch,
  type SendOutcome,
} from "@/lib/mailing/queue";
import type { MailingTemplate } from "@/lib/mailing/templates";

type StoredRecipient = QueueRecipient & {
  status: RecipientStatus;
  errors: Partial<Record<MailingChannel, string | null>>;
  sentAt: Date | null;
  emailSentAt: Date | null;
  dryRun: boolean;
};
type StoredCampaign = QueueCampaign & { scheduledAt: Date | null; preparedAt: Date | null; prepareError: string | null };

const FIELD: Record<MailingChannel, "emailStatus" | "inAppStatus" | "pushStatus" | "telegramStatus"> = {
  email: "emailStatus",
  inApp: "inAppStatus",
  push: "pushStatus",
  telegram: "telegramStatus",
};

class MemoryStore implements MailingQueueStore {
  campaigns = new Map<string, StoredCampaign>();
  recipients: StoredRecipient[] = [];
  suppressed = new Set<string>();
  optedOut = new Set<string>();
  contacts = new Map<string, string>();
  bounced: string[] = [];
  contactSent: string[] = [];
  prepareCalls = 0;

  addCampaign(c: Partial<StoredCampaign> & { id: string }) {
    this.campaigns.set(c.id, {
      kind: "test",
      payload: { text: "Привет" },
      status: "sending",
      scheduledAt: null,
      preparedAt: new Date(0),
      prepareError: null,
      ...c,
    });
  }

  add(r: Partial<StoredRecipient> & { id: string }) {
    this.recipients.push({
      campaignId: "c1",
      token: `${r.id}.sig`,
      userId: null,
      contactId: null,
      email: null,
      name: null,
      companyName: null,
      sphere: null,
      organizationId: null,
      isTest: false,
      emailStatus: null,
      inAppStatus: null,
      pushStatus: null,
      telegramStatus: null,
      attempts: 0,
      nextAttemptAt: null,
      links: [],
      payload: null,
      status: "queued",
      errors: {},
      sentAt: null,
      emailSentAt: null,
      dryRun: false,
      ...r,
    });
  }

  get(id: string): StoredRecipient {
    const r = this.recipients.find((x) => x.id === id);
    if (!r) throw new Error(`no recipient ${id}`);
    return r;
  }

  async startDueScheduled(now: Date) {
    const ids: string[] = [];
    for (const c of this.campaigns.values()) {
      if (c.status === "scheduled" && c.scheduledAt && c.scheduledAt <= now) {
        c.status = "sending";
        ids.push(c.id);
      }
    }
    return ids;
  }
  async campaignsToPrepare() {
    return [...this.campaigns.values()].filter((c) => c.status === "sending" && !c.preparedAt);
  }
  async prepareRecipients(campaignId: string) {
    return this.recipients
      .filter((r) => r.campaignId === campaignId && !r.isTest)
      .map((r) => ({ id: r.id, email: r.email, organizationId: r.organizationId, companyName: r.companyName, sphere: r.sphere }));
  }
  async savePrepared(campaignId: string, personal: Record<string, Record<string, unknown>>, now: Date) {
    this.prepareCalls += 1;
    for (const [id, data] of Object.entries(personal)) {
      const r = this.get(id);
      r.payload = { ...(r.payload ?? {}), ...data };
    }
    const c = this.campaigns.get(campaignId);
    if (c) c.preparedAt = now;
  }
  async savePrepareError(campaignId: string, error: string) {
    const c = this.campaigns.get(campaignId);
    if (c) c.prepareError = error;
  }
  async failStaleSending() {
    let count = 0;
    for (const r of this.recipients) {
      if (r.isTest) continue;
      let touched = false;
      for (const ch of Object.keys(FIELD) as MailingChannel[]) {
        if (r[FIELD[ch]] === "sending") {
          r[FIELD[ch]] = "failed";
          r.errors[ch] = "прервано";
          touched = true;
        }
      }
      if (touched) {
        count += 1;
        r.status = overallRecipientStatus([r.emailStatus, r.inAppStatus, r.pushStatus, r.telegramStatus]);
      }
    }
    return count;
  }
  async listDueRecipients(now: Date, limit: number, emailAllowed: boolean) {
    return this.recipients
      .filter((r) => {
        const c = this.campaigns.get(r.campaignId);
        if (!c || c.status !== "sending" || !c.preparedAt || r.isTest || r.status !== "queued") return false;
        if (r.nextAttemptAt && r.nextAttemptAt > now) return false;
        const other = r.inAppStatus === "queued" || r.pushStatus === "queued" || r.telegramStatus === "queued";
        return other || (emailAllowed && r.emailStatus === "queued");
      })
      .slice(0, limit)
      .map((r) => ({ ...r, links: [...r.links] }));
  }
  async getCampaign(id: string) {
    const c = this.campaigns.get(id);
    return c ? { id: c.id, kind: c.kind, payload: c.payload, status: c.status } : null;
  }
  async countEmailsSentSince(since: Date) {
    return this.recipients.filter((r) => !r.isTest && r.emailSentAt && r.emailSentAt >= since).length;
  }
  async suppressedEmails(emails: string[]) {
    return new Set(emails.filter((e) => this.suppressed.has(e)));
  }
  async optedOutUsers(userIds: string[]) {
    return new Set(userIds.filter((id) => this.optedOut.has(id)));
  }
  async contactStatuses(contactIds: string[]) {
    return new Map(contactIds.filter((id) => this.contacts.has(id)).map((id) => [id, this.contacts.get(id) as string]));
  }
  async claimChannels(id: string, channels: MailingChannel[], links: string[], options: { requireSending: boolean }) {
    const r = this.get(id);
    const c = this.campaigns.get(r.campaignId);
    if (options.requireSending && c?.status !== "sending") return false;
    if (channels.some((ch) => r[FIELD[ch]] !== "queued")) return false;
    for (const ch of channels) r[FIELD[ch]] = "sending";
    r.links = [...links];
    return true;
  }
  async saveRecipient(id: string, patch: RecipientPatch) {
    const r = this.get(id);
    for (const ch of Object.keys(FIELD) as MailingChannel[]) {
      const status = patch[FIELD[ch]];
      if (status !== undefined) r[FIELD[ch]] = status;
      const errKey = `${ch}Error` as keyof RecipientPatch;
      if (patch[errKey] !== undefined) r.errors[ch] = patch[errKey] as string | null;
    }
    if (patch.status) r.status = patch.status;
    if (patch.attempts !== undefined) r.attempts = patch.attempts;
    if (patch.nextAttemptAt !== undefined) r.nextAttemptAt = patch.nextAttemptAt;
    if (patch.sentAt) r.sentAt = patch.sentAt;
    if (patch.emailSentAt) r.emailSentAt = patch.emailSentAt;
    if (patch.links) r.links = patch.links;
    if (patch.dryRun) r.dryRun = true;
  }
  async markBounced(email: string) {
    this.bounced.push(email);
  }
  async markContactSent(contactId: string) {
    this.contactSent.push(contactId);
  }
  async finishCampaignIfDone(id: string) {
    const c = this.campaigns.get(id);
    if (!c || c.status !== "sending") return false;
    if (this.recipients.some((r) => r.campaignId === id && !r.isTest && r.status === "queued")) return false;
    c.status = "done";
    return true;
  }
  async refreshCounters() {}
}

type Script = Partial<Record<MailingChannel, (msg: unknown, call: number) => SendOutcome>>;

function fakeSenders(script: Script = {}) {
  const calls: Record<MailingChannel, unknown[]> = { email: [], inApp: [], push: [], telegram: [] };
  const run = (channel: MailingChannel) => async (msg: unknown): Promise<SendOutcome> => {
    calls[channel].push(msg);
    const fn = script[channel];
    return fn ? fn(msg, calls[channel].length) : { kind: "sent" };
  };
  const senders: ChannelSenders = {
    email: run("email"),
    inApp: run("inApp"),
    push: run("push"),
    telegram: run("telegram"),
  };
  return { senders, calls };
}

const template: MailingTemplate<{ text: string }> = {
  kind: "test",
  label: "Тест",
  async render(payload, ctx) {
    const link = ctx.trackUrl("https://wesetup.ru/pricing");
    return {
      email: {
        subject: `Тема для ${ctx.name ?? "всех"}`,
        html: `<html><body><p>${payload.text} ${link} ${String(ctx.personal.code ?? "")}</p></body></html>`,
        text: payload.text,
      },
      inApp: { title: "Тема", body: payload.text },
      push: { title: "Тема", body: payload.text },
      telegram: { text: payload.text },
    };
  },
};

function deps(store: MemoryStore, senders: ChannelSenders, now: Date, over: Partial<QueueDeps> = {}): QueueDeps {
  return {
    store,
    senders,
    settings: { perMinute: 100, perDay: 1000 },
    appUrl: "https://wesetup.ru",
    now: () => now,
    template: (kind) => (kind === "test" ? template : null),
    log: () => {},
    ...over,
  };
}

const T0 = new Date("2026-09-29T09:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("стоп-лист и отписка → skipped", () => {
  it("письмо пропускается, остальные каналы уходят", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1" });
    const both = { emailStatus: "queued" as ChannelStatus, inAppStatus: "queued" as ChannelStatus };
    store.add({ id: "stop", userId: "u1", email: "stop@a.ru", ...both });
    store.add({ id: "optout", userId: "u2", email: "opt@a.ru", ...both });
    store.add({ id: "contact", contactId: "k1", email: "k@a.ru", emailStatus: "queued" });
    store.add({ id: "ok", userId: "u3", email: "ok@a.ru", ...both });
    store.add({ id: "nomail", userId: "u4", email: null, ...both });
    store.suppressed.add("stop@a.ru");
    store.optedOut.add("u2");
    store.contacts.set("k1", "unsubscribed");
    const { senders, calls } = fakeSenders();

    const report = await runQueuePass(deps(store, senders, T0));

    assert.equal(store.get("stop").emailStatus, "skipped");
    assert.equal(store.get("stop").errors.email, "Адрес в стоп-листе");
    assert.equal(store.get("stop").inAppStatus, "sent");
    assert.equal(store.get("optout").emailStatus, "skipped");
    assert.equal(store.get("optout").errors.email, "Отписался от новостей и предложений");
    assert.equal(store.get("contact").emailStatus, "skipped");
    assert.equal(store.get("contact").status, "skipped");
    assert.equal(store.get("nomail").emailStatus, "skipped");
    assert.equal(store.get("ok").emailStatus, "sent");
    assert.deepEqual(
      calls.email.map((m) => (m as OutgoingEmail).to),
      ["ok@a.ru"]
    );
    assert.equal(report.sent.email, 1);
    assert.deepEqual(report.finishedCampaigns, ["c1"]);
  });

  it("канал только для пользователей у контакта — пропуск", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1" });
    store.add({ id: "k", contactId: "k2", email: "k2@a.ru", emailStatus: "queued", telegramStatus: "queued" });
    const { senders, calls } = fakeSenders();
    await runQueuePass(deps(store, senders, T0));
    assert.equal(store.get("k").telegramStatus, "skipped");
    assert.equal(calls.telegram.length, 0);
    assert.deepEqual(store.contactSent, ["k2"]);
  });
});

describe("идемпотентность", () => {
  it("второй проход ничего не отправляет повторно", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1" });
    store.add({ id: "r1", userId: "u1", email: "a@a.ru", emailStatus: "queued", telegramStatus: "queued" });
    const { senders, calls } = fakeSenders();
    await runQueuePass(deps(store, senders, T0));
    await runQueuePass(deps(store, senders, at(120_000)));
    assert.equal(calls.email.length, 1);
    assert.equal(calls.telegram.length, 1);
    assert.equal(store.get("r1").status, "sent");
  });

  it("канал, зависший в «sending» после падения, не повторяется", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1" });
    store.add({ id: "r1", userId: "u1", email: "a@a.ru", emailStatus: "sending", inAppStatus: "queued" });
    const { senders, calls } = fakeSenders();
    const report = await runQueuePass(deps(store, senders, T0));
    assert.equal(report.staleFailed, 1);
    assert.equal(store.get("r1").emailStatus, "failed");
    assert.equal(calls.email.length, 0);
    // Остальные каналы дошли.
    assert.equal(store.get("r1").inAppStatus, "sent");
  });

  it("ссылки получателя сохраняются, письмо получает ссылку отписки", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1" });
    store.add({ id: "r1", userId: "u1", email: "a@a.ru", emailStatus: "queued" });
    const { senders, calls } = fakeSenders();
    await runQueuePass(deps(store, senders, T0));
    assert.deepEqual(store.get("r1").links, ["https://wesetup.ru/pricing"]);
    const msg = calls.email[0] as OutgoingEmail;
    assert.match(msg.html, /https:\/\/wesetup\.ru\/r\/r1\.sig\/0/);
    assert.match(msg.html, /https:\/\/wesetup\.ru\/unsubscribe\/r1\.sig/);
    assert.equal(msg.oneClickUrl, "https://wesetup.ru/api/mailing/unsubscribe/r1.sig");
  });
});

describe("повторы", () => {
  it("временный сбой — повтор через паузу, потом успех", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1" });
    store.add({ id: "r1", email: "a@a.ru", emailStatus: "queued" });
    const { senders, calls } = fakeSenders({
      email: (_m, call) => (call < 3 ? { kind: "failed", error: "ETIMEDOUT", transient: true } : { kind: "sent" }),
    });
    await runQueuePass(deps(store, senders, T0));
    let r = store.get("r1");
    assert.equal(r.emailStatus, "queued");
    assert.equal(r.attempts, 1);
    assert.equal(r.nextAttemptAt?.toISOString(), at(60_000).toISOString());
    assert.match(r.errors.email ?? "", /Попытка 1: ETIMEDOUT/);

    await runQueuePass(deps(store, senders, at(30_000)));
    assert.equal(calls.email.length, 1, "до паузы не трогаем");

    await runQueuePass(deps(store, senders, at(61_000)));
    r = store.get("r1");
    assert.equal(r.attempts, 2);
    assert.equal(r.nextAttemptAt?.toISOString(), at(61_000 + 5 * 60_000).toISOString());

    await runQueuePass(deps(store, senders, at(7 * 60_000)));
    r = store.get("r1");
    assert.equal(r.emailStatus, "sent");
    assert.equal(r.status, "sent");
    assert.equal(r.nextAttemptAt, null);
    assert.equal(calls.email.length, 3);
  });

  it(`не больше ${MAX_ATTEMPTS} попыток`, async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1" });
    store.add({ id: "r1", email: "a@a.ru", emailStatus: "queued" });
    const { senders, calls } = fakeSenders({
      email: () => ({ kind: "failed", error: "421 try later", transient: true }),
    });
    for (const t of [0, 61_000, 7 * 60_000, 20 * 60_000, 40 * 60_000]) {
      await runQueuePass(deps(store, senders, at(t)));
    }
    assert.equal(calls.email.length, MAX_ATTEMPTS);
    assert.equal(store.get("r1").emailStatus, "failed");
    assert.equal(store.get("r1").status, "failed");
  });

  it("постоянный отказ — сразу ошибка, несуществующий адрес — в стоп-лист", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1" });
    store.add({ id: "r1", email: "nobody@a.ru", emailStatus: "queued" });
    const { senders, calls } = fakeSenders({
      email: () => ({ kind: "failed", error: "550 user unknown", transient: false, bounce: true }),
    });
    await runQueuePass(deps(store, senders, T0));
    await runQueuePass(deps(store, senders, at(10 * 60_000)));
    assert.equal(calls.email.length, 1);
    assert.equal(store.get("r1").emailStatus, "failed");
    assert.deepEqual(store.bounced, ["nobody@a.ru"]);
  });
});

describe("ограничение скорости и суточный лимит", () => {
  it("в минуту и в сутки — не больше настройки, остальные ждут", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1" });
    for (let i = 1; i <= 5; i += 1) store.add({ id: `r${i}`, email: `r${i}@a.ru`, emailStatus: "queued" });
    const { senders, calls } = fakeSenders();
    const settings = { perMinute: 2, perDay: 3 };

    const p1 = await runQueuePass(deps(store, senders, T0, { settings }));
    assert.equal(p1.sent.email, 2);
    assert.equal(p1.deferredByLimit, 3);
    assert.equal(p1.limitedBy, "minute");

    const p2 = await runQueuePass(deps(store, senders, at(10_000), { settings }));
    assert.equal(p2.sent.email, 0);
    assert.equal(p2.emailBudget, 0);

    const p3 = await runQueuePass(deps(store, senders, at(61_000), { settings }));
    assert.equal(p3.sent.email, 1, "суточный лимит 3");
    assert.equal(p3.limitedBy, "day");

    const p4 = await runQueuePass(deps(store, senders, at(10 * 60_000), { settings }));
    assert.equal(p4.sent.email, 0);
    assert.equal(p4.limitedBy, "day");
    assert.equal(store.campaigns.get("c1")?.status, "sending");

    // Следующие сутки по Москве.
    const p5 = await runQueuePass(deps(store, senders, new Date("2026-09-29T21:00:30Z"), { settings }));
    assert.equal(p5.sent.email, 2);
    assert.equal(calls.email.length, 5);
    assert.equal(store.campaigns.get("c1")?.status, "done");
  });

  it("лимит писем не держит колокольчик и Telegram", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1" });
    store.add({ id: "r1", userId: "u1", email: "a@a.ru", emailStatus: "queued", inAppStatus: "queued" });
    store.add({ id: "r2", userId: "u2", email: "b@a.ru", emailStatus: "queued", inAppStatus: "queued" });
    const { senders, calls } = fakeSenders();
    await runQueuePass(deps(store, senders, T0, { settings: { perMinute: 1, perDay: 10 } }));
    assert.equal(calls.email.length, 1);
    assert.equal(calls.inApp.length, 2);
    assert.equal(store.get("r2").emailStatus, "queued");
    assert.equal(store.get("r2").inAppStatus, "sent");
    assert.equal(store.get("r2").status, "queued");
  });
});

describe("отмена и подготовка", () => {
  it("отменённая посреди прохода рассылка ничего не отправляет", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1" });
    store.add({ id: "r1", email: "a@a.ru", emailStatus: "queued" });
    const claim = store.claimChannels.bind(store);
    store.claimChannels = async (...args) => {
      const c = store.campaigns.get("c1");
      if (c) c.status = "cancelled";
      return claim(...args);
    };
    const { senders, calls } = fakeSenders();
    await runQueuePass(deps(store, senders, T0));
    assert.equal(calls.email.length, 0);
    assert.equal(store.get("r1").emailStatus, "queued");
  });

  it("запланированная стартует в срок, prepare — один раз, данные уходят в шаблон", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1", status: "scheduled", scheduledAt: at(60_000), preparedAt: null });
    store.add({ id: "r1", email: "a@a.ru", emailStatus: "queued" });
    let prepared = 0;
    const withPrepare: MailingTemplate<{ text: string }> = {
      ...template,
      async prepare(_campaign, recipients) {
        prepared += 1;
        return Object.fromEntries(recipients.map((r) => [r.id, { code: `PROMO-${r.id}` }]));
      },
    };
    const { senders, calls } = fakeSenders();
    const d = (now: Date) => deps(store, senders, now, { template: () => withPrepare });

    const early = await runQueuePass(d(T0));
    assert.equal(early.startedScheduled, 0);
    assert.equal(calls.email.length, 0);

    const onTime = await runQueuePass(d(at(60_000)));
    assert.equal(onTime.startedScheduled, 1);
    assert.equal(prepared, 1);
    assert.match((calls.email[0] as OutgoingEmail).html, /PROMO-r1/);

    await runQueuePass(d(at(120_000)));
    assert.equal(prepared, 1);
  });

  it("сбой prepare — рассылка ждёт, получатели не трогаются", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1", preparedAt: null });
    store.add({ id: "r1", email: "a@a.ru", emailStatus: "queued" });
    const failing: MailingTemplate<{ text: string }> = {
      ...template,
      async prepare() {
        throw new Error("промокоды недоступны");
      },
    };
    const { senders, calls } = fakeSenders();
    await runQueuePass(deps(store, senders, T0, { template: () => failing }));
    assert.equal(calls.email.length, 0);
    assert.equal(store.campaigns.get("c1")?.prepareError, "промокоды недоступны");
    assert.equal(store.get("r1").status, "queued");
  });
});

describe("тестовая отправка", () => {
  it("идёт мимо стоп-листа и лимита, но только в выбранные каналы", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1", status: "draft" });
    store.add({ id: "t1", isTest: true, userId: "root", email: "root@a.ru", emailStatus: "queued", pushStatus: "queued" });
    const { senders, calls } = fakeSenders({ push: () => ({ kind: "skipped", reason: "Нет подписок" }) });
    const campaign = (await store.getCampaign("c1")) as QueueCampaign;
    const result = await deliverRecipient(store.get("t1"), campaign, deps(store, senders, T0), {
      test: true,
      emailBudget: { remaining: 0 },
      gate: { suppressed: new Set(["root@a.ru"]), optedOut: new Set(["root"]), contactStatus: new Map() },
    });
    assert.equal(result.channels.email?.status, "sent");
    assert.equal(result.channels.push?.status, "skipped");
    assert.equal(calls.email.length, 1);
    assert.equal((calls.email[0] as OutgoingEmail).isTest, true);
  });
});
