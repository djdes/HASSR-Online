import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { matchPlatformRule } from "@/lib/platform-access";
import {
  readSignupSnapshot,
  signupChannel,
  signupSourceSummary,
  type SignupSourceSnapshot,
} from "@/lib/signup-channel";
import {
  buildFunnel,
  funnelWeekKeys,
  funnelWindowStart,
  moscowWeekStart,
  stepShare,
  weekLabel,
  type FunnelOrg,
} from "@/lib/signup-funnel";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function snap(patch: Partial<SignupSourceSnapshot>): SignupSourceSnapshot {
  return { place: "hero", landing: "/", referrer: "", utmSource: "", utmMedium: "", utmCampaign: "", ...patch };
}

describe("канал регистрации", () => {
  it("utm важнее referrer: Директ, Telegram, прочая реклама", () => {
    assert.equal(signupChannel(snap({ utmSource: "yandex", utmMedium: "cpc", referrer: "https://yandex.ru/" })), "yandex_direct");
    assert.equal(signupChannel(snap({ utmSource: "tg" })), "telegram");
    assert.equal(signupChannel(snap({ utmSource: "vk", utmMedium: "post" })), "vk");
    assert.equal(signupChannel(snap({ utmSource: "partner-blog" })), "utm");
  });

  it("по referrer: поиск, мессенджеры, свой сайт, чужие сайты, прямой заход", () => {
    assert.equal(signupChannel(snap({ referrer: "https://yandex.ru/search/?text=журнал" })), "search_yandex");
    assert.equal(signupChannel(snap({ referrer: "https://ya.ru/" })), "search_yandex");
    assert.equal(signupChannel(snap({ referrer: "https://www.google.com/" })), "search_google");
    assert.equal(signupChannel(snap({ referrer: "https://t.me/wesetup" })), "telegram");
    assert.equal(signupChannel(snap({ referrer: "https://m.vk.com/wall" })), "vk");
    assert.equal(signupChannel(snap({ referrer: "https://web.max.ru/" })), "max");
    assert.equal(signupChannel(snap({ referrer: "https://wesetup.ru/blog/x" })), "direct");
    assert.equal(signupChannel(snap({ referrer: "" })), "direct");
    assert.equal(signupChannel(snap({ referrer: "https://restoclub.ru/news" })), "site");
    assert.equal(signupChannel(snap({ referrer: "не адрес" })), "direct");
  });

  it("партнёр и рекомендация клиента важнее снимка; без снимка — «нет данных»", () => {
    const fromSearch = snap({ referrer: "https://yandex.ru/" });
    assert.equal(signupChannel(fromSearch, { partner: true }), "partner");
    assert.equal(signupChannel(fromSearch, { clientReferral: true }), "client_referral");
    assert.equal(signupChannel(null), "unknown");
    assert.equal(signupChannel(readSignupSnapshot({})), "unknown");
  });

  it("снимок: только строки, обрезка по длине; сводка для админа с кампанией и посадочной", () => {
    const parsed = readSignupSnapshot({ place: "x".repeat(60), referrer: 5, utmSource: " yandex ", utmMedium: "cpc", utmCampaign: "kafe" });
    assert.equal(parsed.place.length, 40);
    assert.equal(parsed.referrer, "");
    assert.equal(parsed.utmSource, "yandex");
    assert.equal(signupSourceSummary({ ...parsed, landing: "/dlya-kafe" }), "Яндекс Директ · yandex / cpc / kafe · вход: /dlya-kafe");
    assert.equal(signupSourceSummary(snap({ referrer: "https://restoclub.ru/a", landing: "/" })), "Другие сайты · restoclub.ru · вход: /");
    assert.equal(signupSourceSummary(null), "Нет данных");
  });
});

describe("воронка по неделям и каналам", () => {
  // Среда, 04.11.2026, 12:00 по Москве.
  const now = new Date("2026-11-04T09:00:00Z");

  it("неделя — с понедельника по Москве; окно — 12 недель", () => {
    // Вс 01.11 23:30 МСК — ещё неделя 26.10; Пн 02.11 00:10 МСК — уже 02.11.
    assert.equal(moscowWeekStart(new Date("2026-11-01T20:30:00Z")), "2026-10-26");
    assert.equal(moscowWeekStart(new Date("2026-11-01T21:10:00Z")), "2026-11-02");
    assert.equal(funnelWindowStart(now).toISOString(), "2026-08-16T21:00:00.000Z");
    const keys = funnelWeekKeys(now);
    assert.equal(keys.length, 12);
    assert.equal(keys[0], "2026-11-02");
    assert.equal(keys[11], "2026-08-17");
    assert.equal(weekLabel("2026-10-26"), "26.10 – 01.11");
  });

  it("шаги и доли считаются от регистраций строки; вне окна — не считаем", () => {
    const org = (createdAt: string, patch: Partial<FunnelOrg>): FunnelOrg => ({
      createdAt: new Date(createdAt),
      channel: "direct",
      profileDone: false,
      hasEntry: false,
      activeUsers: 1,
      paid: false,
      ...patch,
    });
    const funnel = buildFunnel(
      [
        org("2026-11-02T08:00:00Z", { channel: "yandex_direct", profileDone: true, hasEntry: true, activeUsers: 3, paid: true }),
        org("2026-11-03T08:00:00Z", { channel: "yandex_direct", profileDone: true }),
        org("2026-11-03T09:00:00Z", { channel: "search_yandex", profileDone: true, hasEntry: true, activeUsers: 2 }),
        org("2026-10-27T09:00:00Z", { channel: "unknown" }),
        org("2026-08-01T09:00:00Z", { channel: "partner", paid: true }),
      ],
      now,
    );
    assert.deepEqual(funnel.weeks[0].counts, { registered: 3, profile: 3, firstEntry: 2, team: 2, paid: 1 });
    assert.equal(funnel.weeks[0].label, "02.11 – 08.11");
    assert.deepEqual(funnel.weeks[1].counts, { registered: 1, profile: 0, firstEntry: 0, team: 0, paid: 0 });
    assert.deepEqual(funnel.total.counts, { registered: 4, profile: 3, firstEntry: 2, team: 2, paid: 1 });
    assert.equal(stepShare(funnel.total.counts, "profile"), 75);
    assert.equal(stepShare(funnel.total.counts, "paid"), 25);
    assert.equal(stepShare(funnel.weeks[5].counts, "paid"), null);
    assert.deepEqual(
      funnel.channels.map((row) => [row.label, row.counts.registered, row.counts.paid]),
      [["Яндекс Директ", 2, 1], ["Поиск Яндекса", 1, 0], ["Нет данных", 1, 0]],
    );
  });

  it("регистрация пишет источник, страница — только для раздела «Клиенты» и есть в меню", () => {
    const register = read("src/app/api/auth/instant-register/route.ts");
    assert.match(register, /readSignupSnapshot\(/);
    assert.match(register, /isEmptySnapshot\(source\) \? \{\} : \{ signupSourceJson: source \}/);
    assert.match(read("prisma/schema.prisma"), /signupSourceJson\s+Json\?/);
    assert.equal(matchPlatformRule("/root/funnel")?.gate, "clients");
    assert.match(read("src/app/root/funnel/page.tsx"), /await requireRoot\(\);/);
    assert.match(read("src/components/root/root-nav.tsx"), /\{ href: "\/root\/funnel", label: "funnel", icon: Filter \}/);
    const server = read("src/lib/signup-funnel.server.ts");
    assert.match(server, /isDemo: false/);
    assert.match(server, /tariffKey: \{ not: BALANCE_TOPUP_TARIFF \}/);
    assert.match(server, /refundedAt: null/);
    assert.match(server, /isTest: false/);
  });
});
