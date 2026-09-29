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
  /** Стоп-лист: адрес → причина. */
  suppressed = new Map<string, string>();
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
      .filter((r) => r.campaignId === campaignId && !r.isTest && r.status === "queued")
      .map((r) => ({
        id: r.id,
        email: r.email,
        organizationId: r.organizationId,
        companyName: r.companyName,
        sphere: r.sphere,
        payload: r.payload,
      }));
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
    return c ? { id: c.id, title: c.title, kind: c.kind, payload: c.payload, status: c.status } : null;
  }
  async countEmailsSentSince(since: Date) {
    return this.recipients.filter((r) => !r.isTest && r.emailSentAt && r.emailSentAt >= since).length;
  }
  async suppressedEmails(emails: string[]) {
    return new Map(emails.filter((e) => this.suppressed.has(e)).map((e) => [e, this.suppressed.get(e) as string]));
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
  it("письмо пропускается; адрес «не принимает почту» — остальные каналы уходят", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1" });
    const both = { emailStatus: "queued" as ChannelStatus, inAppStatus: "queued" as ChannelStatus };
    store.add({ id: "stop", userId: "u1", email: "stop@a.ru", ...both });
    store.add({ id: "optout", userId: "u2", email: "opt@a.ru", ...both });
    store.add({ id: "contact", contactId: "k1", email: "k@a.ru", emailStatus: "queued" });
    store.add({ id: "ok", userId: "u3", email: "ok@a.ru", ...both });
    store.add({ id: "nomail", userId: "u4", email: null, ...both });
    store.suppressed.set("stop@a.ru", "bounced");
    store.optedOut.add("u2");
    store.contacts.set("k1", "unsubscribed");
    const { senders, calls } = fakeSenders();

    const report = await runQueuePass(deps(store, senders, T0));

    assert.equal(store.get("stop").emailStatus, "skipped");
    assert.equal(store.get("stop").errors.email, "Адрес в стоп-листе");
    assert.equal(store.get("stop").inAppStatus, "sent");
    assert.equal(store.get("optout").emailStatus, "skipped");
    assert.equal(store.get("optout").errors.email, "Отписался от новостей и предложений");
    assert.equal(store.get("optout").inAppStatus, "skipped");
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

  it("отписка — во ВСЕХ каналах: почта, колокольчик, push, Telegram (38-ФЗ ст. 18)", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1" });
    const all = {
      emailStatus: "queued" as ChannelStatus,
      inAppStatus: "queued" as ChannelStatus,
      pushStatus: "queued" as ChannelStatus,
      telegramStatus: "queued" as ChannelStatus,
    };
    store.add({ id: "optout", userId: "u1", email: "opt@a.ru", ...all });
    store.add({ id: "unsub", userId: "u2", email: "unsub@a.ru", ...all });
    store.add({ id: "spam", userId: "u3", email: "spam@a.ru", ...all });
    store.add({ id: "manual", userId: "u4", email: "manual@a.ru", ...all });
    store.add({ id: "bounced", userId: "u5", email: "bounced@a.ru", ...all });
    store.add({ id: "ok", userId: "u6", email: "ok@a.ru", ...all });
    store.optedOut.add("u1");
    store.suppressed.set("unsub@a.ru", "unsubscribed");
    store.suppressed.set("spam@a.ru", "complained");
    store.suppressed.set("manual@a.ru", "manual");
    store.suppressed.set("bounced@a.ru", "bounced");
    const { senders, calls } = fakeSenders();

    await runQueuePass(deps(store, senders, T0));

    const channels = (id: string) => {
      const r = store.get(id);
      return [r.emailStatus, r.inAppStatus, r.pushStatus, r.telegramStatus];
    };
    for (const id of ["optout", "unsub", "spam", "manual"]) {
      assert.deepEqual(channels(id), ["skipped", "skipped", "skipped", "skipped"], id);
      assert.equal(store.get(id).status, "skipped", id);
    }
    assert.equal(store.get("optout").errors.telegram, "Отписался от новостей и предложений");
    assert.equal(store.get("optout").errors.push, "Отписался от новостей и предложений");
    assert.equal(store.get("unsub").errors.inApp, "Адрес в стоп-листе");
    // «Не принимает почту» — не отказ от рекламы: теряется только письмо.
    assert.deepEqual(channels("bounced"), ["skipped", "sent", "sent", "sent"]);
    assert.deepEqual(channels("ok"), ["sent", "sent", "sent", "sent"]);
    const to = (list: unknown[]) => list.map((m) => (m as { recipientId: string }).recipientId).sort();
    assert.deepEqual(to(calls.email), ["ok"]);
    assert.deepEqual(to(calls.inApp), ["bounced", "ok"]);
    assert.deepEqual(to(calls.push), ["bounced", "ok"]);
    assert.deepEqual(to(calls.telegram), ["bounced", "ok"]);
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

  it("prepare получает название рассылки и уже подготовленное; пропущенным — ничего", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1", title: "КП октябрь", preparedAt: null });
    store.add({ id: "r1", email: "a@a.ru", emailStatus: "queued", payload: { code: "OLD-r1" } });
    store.add({ id: "r2", email: "b@a.ru", emailStatus: "queued" });
    store.add({ id: "r3", email: "stop@a.ru", emailStatus: "skipped", status: "skipped" });
    const seen: Array<{ title: string; recipients: Array<{ id: string; personal: Record<string, unknown> }> }> = [];
    const withPrepare: MailingTemplate<{ text: string }> = {
      ...template,
      async prepare(campaign, recipients) {
        seen.push({ title: campaign.title, recipients: recipients.map((r) => ({ id: r.id, personal: r.personal })) });
        // Идемпотентно: у кого код уже есть — не трогаем.
        return Object.fromEntries(recipients.filter((r) => !r.personal.code).map((r) => [r.id, { code: `NEW-${r.id}` }]));
      },
    };
    const { senders, calls } = fakeSenders();
    await runQueuePass(deps(store, senders, T0, { template: () => withPrepare }));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].title, "КП октябрь");
    assert.deepEqual(seen[0].recipients, [
      { id: "r1", personal: { code: "OLD-r1" } },
      { id: "r2", personal: {} },
    ]);
    assert.deepEqual(store.get("r1").payload, { code: "OLD-r1" });
    assert.deepEqual(store.get("r2").payload, { code: "NEW-r2" });
    assert.equal(store.get("r3").payload, null);
    const html = calls.email.map((m) => (m as OutgoingEmail).html).join("\n");
    assert.match(html, /OLD-r1/);
    assert.match(html, /NEW-r2/);
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
  const withNotes: MailingTemplate<{ text: string }> = {
    ...template,
    async render(payload, ctx) {
      const base = await template.render(payload, ctx);
      return ctx.mode === "live"
        ? base
        : { ...base, telegram: { text: "<b>КП</b>" }, notes: [`Промокод ROMASHKA10 — пример (${ctx.mode}).`] };
    },
  };

  it("пометки шаблона — плашкой в тестовом письме, строкой в Telegram и в результате", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1", status: "draft" });
    store.add({ id: "t1", isTest: true, userId: "root", email: "root@a.ru", emailStatus: "queued", telegramStatus: "queued" });
    const { senders, calls } = fakeSenders();
    const campaign = (await store.getCampaign("c1")) as QueueCampaign;
    const result = await deliverRecipient(store.get("t1"), campaign, deps(store, senders, T0, { template: () => withNotes }), {
      test: true,
      emailBudget: { remaining: 1 },
      gate: { suppressed: new Map(), optedOut: new Set(), contactStatus: new Map() },
    });
    assert.deepEqual(result.notes, ["Промокод ROMASHKA10 — пример (test)."]);
    const email = calls.email[0] as OutgoingEmail;
    assert.match(email.html, /<body><div data-mailing-test-note[^>]*>Тестовое письмо\. Промокод ROMASHKA10 — пример \(test\)\.<\/div><p>/);
    assert.match(email.text, /^Тестовое письмо\. Промокод ROMASHKA10/);
    assert.equal(
      (calls.telegram[0] as { text: string }).text,
      "<b>КП</b>\n\n<i>Тестовое письмо. Промокод ROMASHKA10 — пример (test).</i>"
    );
  });

  it("настоящая отправка — шаблон видит mode=live, пометок нет", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1" });
    store.add({ id: "r1", email: "a@a.ru", emailStatus: "queued" });
    const { senders, calls } = fakeSenders();
    await runQueuePass(deps(store, senders, T0, { template: () => withNotes }));
    assert.doesNotMatch((calls.email[0] as OutgoingEmail).html, /data-mailing-test-note/);
  });

  it("идёт мимо стоп-листа и лимита, но только в выбранные каналы", async () => {
    const store = new MemoryStore();
    store.addCampaign({ id: "c1", status: "draft" });
    store.add({ id: "t1", isTest: true, userId: "root", email: "root@a.ru", emailStatus: "queued", pushStatus: "queued" });
    const { senders, calls } = fakeSenders({ push: () => ({ kind: "skipped", reason: "Нет подписок" }) });
    const campaign = (await store.getCampaign("c1")) as QueueCampaign;
    const result = await deliverRecipient(store.get("t1"), campaign, deps(store, senders, T0), {
      test: true,
      emailBudget: { remaining: 0 },
      gate: { suppressed: new Map([["root@a.ru", "unsubscribed"]]), optedOut: new Set(["root"]), contactStatus: new Map() },
    });
    assert.equal(result.channels.email?.status, "sent");
    assert.equal(result.channels.push?.status, "skipped");
    assert.equal(calls.email.length, 1);
    assert.equal((calls.email[0] as OutgoingEmail).isTest, true);
  });
});
