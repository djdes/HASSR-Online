import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator } from "use-intl/core";

import {
  buildManagerObligationDigest,
  buildStaffObligationDigest,
} from "@/lib/telegram-obligation-digests";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";

test("buildStaffObligationDigest returns null when there are no open obligations", () => {
  const digest = buildStaffObligationDigest({
    userId: "user_1",
    openObligations: [],
    miniAppBaseUrl: "https://wesetup.ru/mini",
    now: new Date("2026-04-20T06:30:00.000Z"),
  });

  assert.equal(digest, null);
});

test("buildStaffObligationDigest builds a personalize-able payload with the next exact action CTA and daily dedupe key", () => {
  const digest = buildStaffObligationDigest({
    userId: "user_1",
    openObligations: [
      {
        id: "obl_1",
        journalCode: "incoming_control",
        targetPath: "/mini/journals/incoming_control/new",
        template: { name: "Входной контроль", description: null },
      },
      {
        id: "obl_2",
        journalCode: "hygiene",
        targetPath: "/mini/journals/hygiene",
        template: { name: "Журнал гигиены", description: "Смена" },
      },
    ],
    miniAppBaseUrl: "https://wesetup.ru/mini",
    now: new Date("2026-04-20T06:30:00.000Z"),
  });

  assert.ok(digest);
  assert.equal(digest?.kind, "staff");
  assert.equal(digest?.dedupeKey, "telegram-digest:staff:2026-04-20:user_1");
  assert.equal(digest?.openCount, 2);
  assert.equal(digest?.nextObligationId, "obl_1");
  assert.deepEqual(digest?.primaryCta, {
    kind: "obligation",
    label: "Открыть задачу",
    url: "https://wesetup.ru/mini/o/obl_1",
  });
  // Builder возвращает template c placeholder'ами — реальные значения
  // подставит `personalizeMessage` в `notifyEmployee`. Это позволяет
  // приветствию учитывать момент отправки, а не момент сборки дайджеста.
  assert.match(digest?.body ?? "", /\{greeting\}, \{name\}!/);
  assert.match(digest?.body ?? "", /Открыто задач: 2/);
  assert.match(digest?.body ?? "", /Следующее действие: Входной контроль/);
  assert.match(digest?.body ?? "", /• Входной контроль/);
  assert.match(digest?.body ?? "", /• Журнал гигиены/);
});

test("buildManagerObligationDigest builds a personalize-able summary with cabinet CTA and organization-scoped daily dedupe key", () => {
  const digest = buildManagerObligationDigest({
    organizationId: "org_1",
    organizationName: "Kitchen 21",
    summary: {
      total: 10,
      pending: 4,
      done: 6,
      employeesWithPending: 2,
    },
    cabinetUrl: "https://wesetup.ru/mini",
    now: new Date("2026-04-20T06:30:00.000Z"),
  });

  assert.equal(digest.kind, "manager");
  assert.equal(digest.dedupeKey, "telegram-digest:manager:2026-04-20:org_1");
  assert.deepEqual(digest.primaryCta, {
    kind: "cabinet",
    label: "Открыть кабинет",
    url: "https://wesetup.ru/mini",
  });
  assert.deepEqual(digest.summary, {
    total: 10,
    pending: 4,
    done: 6,
    employeesWithPending: 2,
  });
  assert.match(digest.body, /\{greeting\}, \{name\}!/);
  assert.match(digest.body, /<b>Kitchen 21<\/b>/);
  assert.match(digest.body, /Открыто: 4 · Выполнено: 6/);
  assert.match(digest.body, /Сотрудников с открытыми задачами: 2/);
});

test("digest builders escape HTML-sensitive dynamic labels", () => {
  const staffDigest = buildStaffObligationDigest({
    userId: "user_1",
    openObligations: [
      {
        id: "obl_1",
        journalCode: "incoming_control",
        targetPath: "/mini/journals/incoming_control/new",
        template: {
          name: "Incoming <check>",
          description: "Shift & cleanup",
        },
      },
    ],
    miniAppBaseUrl: "https://wesetup.ru/mini",
    now: new Date("2026-04-20T06:30:00.000Z"),
  });
  const managerDigest = buildManagerObligationDigest({
    organizationId: "org_1",
    organizationName: "Kitchen <21> & Co",
    summary: {
      total: 4,
      pending: 1,
      done: 3,
      employeesWithPending: 1,
    },
    cabinetUrl: "https://wesetup.ru/mini",
    now: new Date("2026-04-20T06:30:00.000Z"),
  });

  assert.ok(staffDigest);
  assert.match(staffDigest?.body ?? "", /Incoming &lt;check&gt;/);
  assert.match(staffDigest?.body ?? "", /Shift &amp; cleanup/);
  assert.equal(staffDigest?.body.includes("<check>"), false);
  assert.match(managerDigest.body, /Kitchen &lt;21&gt; &amp; Co/);
  assert.equal(managerDigest.body.includes("<21>"), false);
});

test("localized staff digest keeps escaped data, order, CTA and identifiers across recipient locales", async () => {
  const obligations = Array.from({ length: 7 }, (_, index) => ({
    id: `obl_${index + 1}`,
    journalCode: "incoming_control",
    targetPath: "/mini/journals/incoming_control/new",
    buildingName: index === 0 ? "Kitchen <A> & Co" : null,
    template: {
      name: index === 0 ? "Check <cold> & storage" : `Journal ${index + 1}`,
      description: index === 0 ? "Inspect & record temperature" : null,
    },
  }));
  const rendered: Partial<Record<Locale, NonNullable<ReturnType<typeof buildStaffObligationDigest>>>> = {};

  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages, namespace: "telegramWorkday.digest" });
    const digest = buildStaffObligationDigest({
      userId: "user_1",
      openObligations: obligations,
      miniAppBaseUrl: "https://wesetup.ru/mini/",
      now: new Date("2026-10-15T06:30:00.000Z"),
      presentation: {
        openCount: (count) => t("openCount", { count }),
        nextAction: (title) => t("nextAction", { title }),
        noNextAction: t("noNextAction"),
        todayHeading: t("todayHeading"),
        obligationLine: (values) => t("obligationLine", values),
        locationSuffix: (building) => t("locationSuffix", { building }),
        descriptionSuffix: (description) => t("descriptionSuffix", { description }),
        moreCount: (count) => t("moreCount", { count }),
        openTask: t("openTask"),
        openJournals: t("openJournals"),
      },
    });

    assert.ok(digest);
    rendered[locale] = digest;
    assert.equal(digest.openCount, 7);
    assert.equal(digest.nextObligationId, "obl_1");
    assert.equal(digest.dedupeKey, "telegram-digest:staff:2026-10-15:user_1");
    assert.deepEqual(digest.primaryCta, {
      kind: "obligation",
      label: t("openTask"),
      url: "https://wesetup.ru/mini/o/obl_1",
    });
    assert.match(digest.body, /Check &lt;cold&gt; &amp; storage/);
    assert.match(digest.body, /Kitchen &lt;A&gt; &amp; Co/);
    assert.match(digest.body, /Inspect &amp; record temperature/);
    assert.match(digest.body, /…/);
    assert.equal(digest.body.includes("<cold>"), false);
    assert.equal(digest.body.includes("<A>"), false);
  }

  assert.ok(rendered.ru, "Russian digest was rendered");
  assert.ok(rendered.en, "English digest was rendered");
  assert.ok(rendered.uz, "Uzbek digest was rendered");
  assert.notEqual(rendered.ru.body, rendered.en.body);
  assert.notEqual(rendered.en.body, rendered.uz.body);
});
