import assert from "node:assert/strict";
import test from "node:test";

import {
  clampEscalationMinutes,
  escalateOpenIncidents,
  formatRange,
  isOutOfRange,
  processTemperatureReading,
  subjectKeyForDocumentItem,
  subjectKeyForEquipment,
  type DeviationIncident,
  type Deps,
  type ResponsiblePerson,
} from "./temperature-deviations";

const ORG = "org_1";
const NOW = new Date("2026-09-04T09:00:00.000Z");

type Recorder = {
  incidents: DeviationIncident[];
  responsibleMessages: Array<{ userId: string; text: string }>;
  managementMessages: Array<{ organizationId: string; text: string }>;
  managementEmails: number;
  resolved: Array<{ id: string; reason: string }>;
  escalatedIds: string[];
  touched: string[];
};

function fakeDeps(options?: {
  responsible?: ResponsiblePerson | null;
  escalate?: boolean;
  minutes?: number;
  seed?: DeviationIncident[];
}): { deps: Deps; rec: Recorder } {
  const rec: Recorder = {
    incidents: [...(options?.seed ?? [])],
    responsibleMessages: [],
    managementMessages: [],
    managementEmails: 0,
    resolved: [],
    escalatedIds: [],
    touched: [],
  };
  let seq = rec.incidents.length;

  const deps: Deps = {
    loadOrgSettings: async () => ({
      escalateDeviationsToManagement: options?.escalate ?? true,
      deviationEscalationMinutes: options?.minutes ?? 60,
    }),
    findOpenIncident: async (organizationId, subjectKey) =>
      rec.incidents.find(
        (i) =>
          i.organizationId === organizationId &&
          i.subjectKey === subjectKey &&
          i.resolvedAt === null
      ) ?? null,
    createIncident: async (input) => {
      seq += 1;
      const incident: DeviationIncident = {
        id: `inc_${seq}`,
        organizationId: input.organizationId,
        subjectKey: input.subjectKey,
        subjectName: input.subjectName,
        equipmentId: input.equipmentId,
        documentId: input.documentId,
        responsibleUserId: input.responsibleUserId,
        firstValue: input.value,
        lastValue: input.value,
        tempMin: input.tempMin,
        tempMax: input.tempMax,
        notifiedAt: input.notifiedAt,
        escalatedAt: null,
        resolvedAt: null,
      };
      rec.incidents.push(incident);
      return incident;
    },
    touchIncident: async (incidentId, input) => {
      rec.touched.push(incidentId);
      const found = rec.incidents.find((i) => i.id === incidentId);
      if (found) found.lastValue = input.lastValue;
    },
    resolveIncident: async (incidentId, input) => {
      rec.resolved.push({ id: incidentId, reason: input.reason });
      const found = rec.incidents.find((i) => i.id === incidentId);
      if (found) found.resolvedAt = input.now;
    },
    markEscalated: async (incidentId, now) => {
      rec.escalatedIds.push(incidentId);
      const found = rec.incidents.find((i) => i.id === incidentId);
      if (found) found.escalatedAt = now;
    },
    findResponsible: async () => options?.responsible ?? null,
    notifyResponsible: async (userId, text) => {
      rec.responsibleMessages.push({ userId, text });
    },
    notifyManagement: async (organizationId, text) => {
      rec.managementMessages.push({ organizationId, text });
    },
    emailManagement: async () => {
      rec.managementEmails += 1;
    },
  };

  return { deps, rec };
}

const RESPONSIBLE: ResponsiblePerson = {
  id: "user_resp",
  name: "Анна",
  telegramChatId: "555",
};

function reading(overrides?: Partial<Parameters<typeof processTemperatureReading>[0]>) {
  return {
    organizationId: ORG,
    subjectKey: subjectKeyForEquipment("eq_1"),
    subjectName: "Холодильник №3",
    value: 9,
    tempMin: 2,
    tempMax: 6,
    equipmentId: "eq_1",
    source: "IoT-датчик (авто)",
    now: NOW,
    ...overrides,
  };
}

test("isOutOfRange: границы включительно, пустая граница не ограничивает", () => {
  assert.equal(isOutOfRange(6, 2, 6), false);
  assert.equal(isOutOfRange(6.1, 2, 6), true);
  assert.equal(isOutOfRange(1.9, 2, 6), true);
  assert.equal(isOutOfRange(-30, null, -18), false);
  assert.equal(isOutOfRange(-10, null, -18), true);
  assert.equal(isOutOfRange(100, null, null), false);
});

test("formatRange даёт человеческую запись нормы", () => {
  assert.equal(formatRange(2, 6), "от 2 до 6");
  assert.equal(formatRange(null, -18), "до -18");
  assert.equal(formatRange(null, null), "");
});

test("clampEscalationMinutes держит значение в 5…1440", () => {
  assert.equal(clampEscalationMinutes(60), 60);
  assert.equal(clampEscalationMinutes(1), 5);
  assert.equal(clampEscalationMinutes(99999), 1440);
  assert.equal(clampEscalationMinutes(undefined), 60);
});

// AC1
test("первое отклонение открывает инцидент и пишет ответственному, не руководству", async () => {
  const { deps, rec } = fakeDeps({ responsible: RESPONSIBLE });

  const result = await processTemperatureReading(reading(), deps);

  assert.equal(result.action, "opened");
  assert.equal(result.notifiedResponsibleId, "user_resp");
  assert.equal(rec.incidents.length, 1);
  assert.equal(rec.incidents[0].responsibleUserId, "user_resp");
  assert.equal(rec.responsibleMessages.length, 1);
  assert.match(rec.responsibleMessages[0].text, /Холодильник №3/);
  assert.match(rec.responsibleMessages[0].text, /9°C/);
  assert.equal(rec.managementMessages.length, 0);
  assert.equal(rec.managementEmails, 0);
});

// AC1 (fallback)
test("без ответственного с Telegram сообщение сразу уходит руководству", async () => {
  const { deps, rec } = fakeDeps({ responsible: null });

  const result = await processTemperatureReading(reading(), deps);

  assert.equal(result.action, "escalated");
  assert.equal(rec.responsibleMessages.length, 0);
  assert.equal(rec.managementMessages.length, 1);
  assert.equal(rec.managementEmails, 1);
  assert.equal(rec.escalatedIds.length, 1);
  assert.equal(rec.incidents[0].notifiedAt, null);
});

test("ответственный без Telegram = fallback на руководство", async () => {
  const { deps, rec } = fakeDeps({
    responsible: { id: "u", name: "Пётр", telegramChatId: null },
  });

  const result = await processTemperatureReading(reading(), deps);

  assert.equal(result.action, "escalated");
  assert.equal(rec.responsibleMessages.length, 0);
  assert.equal(rec.managementMessages.length, 1);
});

// AC2
test("повторное отклонение не создаёт второй инцидент и не шлёт повторный пуш", async () => {
  const { deps, rec } = fakeDeps({ responsible: RESPONSIBLE });

  await processTemperatureReading(reading(), deps);
  const second = await processTemperatureReading(
    reading({ value: 11, now: new Date(NOW.getTime() + 10 * 60000) }),
    deps
  );

  assert.equal(second.action, "updated");
  assert.equal(rec.incidents.length, 1);
  assert.equal(rec.incidents[0].lastValue, 11);
  assert.equal(rec.responsibleMessages.length, 1);
  assert.equal(rec.managementMessages.length, 0);
});

// AC3
test("возврат в норму закрывает инцидент и сообщает ответственному", async () => {
  const { deps, rec } = fakeDeps({ responsible: RESPONSIBLE });

  await processTemperatureReading(reading(), deps);
  const result = await processTemperatureReading(
    reading({ value: 4, now: new Date(NOW.getTime() + 20 * 60000) }),
    deps
  );

  assert.equal(result.action, "resolved");
  assert.equal(rec.resolved.length, 1);
  assert.equal(rec.resolved[0].reason, "in_range");
  assert.equal(rec.responsibleMessages.length, 2);
  assert.match(rec.responsibleMessages[1].text, /вернулась в норму/);
});

// AC3
test("корректирующий комментарий закрывает инцидент даже при высокой температуре", async () => {
  const { deps, rec } = fakeDeps({ responsible: RESPONSIBLE });

  await processTemperatureReading(reading(), deps);
  const result = await processTemperatureReading(
    reading({
      value: 8,
      correctionNote: "Переставили продукты, вызвали сервис",
      now: new Date(NOW.getTime() + 25 * 60000),
    }),
    deps
  );

  assert.equal(result.action, "resolved");
  assert.equal(rec.resolved[0].reason, "correction");
  assert.match(rec.responsibleMessages[1].text, /Отклонение отработано/);
});

test("норма без открытого инцидента ничего не делает", async () => {
  const { deps, rec } = fakeDeps({ responsible: RESPONSIBLE });

  const result = await processTemperatureReading(reading({ value: 4 }), deps);

  assert.equal(result.action, "noop");
  assert.equal(rec.incidents.length, 0);
  assert.equal(rec.responsibleMessages.length, 0);
  assert.equal(rec.managementMessages.length, 0);
});

// AC4
test("инцидент старше порога эскалируется руководству ровно один раз", async () => {
  const { deps, rec } = fakeDeps({ responsible: RESPONSIBLE, minutes: 60 });

  await processTemperatureReading(reading(), deps);
  const late = new Date(NOW.getTime() + 61 * 60000);
  const second = await processTemperatureReading(
    reading({ value: 10, now: late }),
    deps
  );
  const third = await processTemperatureReading(
    reading({ value: 10, now: new Date(NOW.getTime() + 90 * 60000) }),
    deps
  );

  assert.equal(second.action, "escalated");
  assert.equal(third.action, "updated");
  assert.equal(rec.managementMessages.length, 1);
  assert.equal(rec.managementEmails, 1);
  assert.equal(rec.escalatedIds.length, 1);
  assert.match(rec.managementMessages[0].text, /не исправлено/);
  assert.match(rec.managementMessages[0].text, /Анна/);
});

// AC4
test("при выключенном флаге эскалации руководству не пишем", async () => {
  const { deps, rec } = fakeDeps({
    responsible: RESPONSIBLE,
    escalate: false,
    minutes: 60,
  });

  await processTemperatureReading(reading(), deps);
  const second = await processTemperatureReading(
    reading({ value: 10, now: new Date(NOW.getTime() + 180 * 60000) }),
    deps
  );

  assert.equal(second.action, "updated");
  assert.equal(rec.managementMessages.length, 0);
  assert.equal(rec.escalatedIds.length, 0);
});

test("до порога эскалации руководство молчит", async () => {
  const { deps, rec } = fakeDeps({ responsible: RESPONSIBLE, minutes: 60 });

  await processTemperatureReading(reading(), deps);
  await processTemperatureReading(
    reading({ value: 10, now: new Date(NOW.getTime() + 30 * 60000) }),
    deps
  );

  assert.equal(rec.managementMessages.length, 0);
});

// AC4 / AC5 — крон догоняет инциденты, по которым показания перестали приходить
test("escalateOpenIncidents эскалирует просроченные инциденты без новых показаний", async () => {
  const seed: DeviationIncident[] = [
    {
      id: "inc_old",
      organizationId: ORG,
      subjectKey: subjectKeyForDocumentItem("doc_1", "item_1"),
      subjectName: "Морозильный ларь",
      equipmentId: null,
      documentId: "doc_1",
      responsibleUserId: "user_resp",
      firstValue: -5,
      lastValue: -5,
      tempMin: null,
      tempMax: -18,
      notifiedAt: new Date(NOW.getTime() - 120 * 60000),
      escalatedAt: null,
      resolvedAt: null,
    },
    {
      id: "inc_fresh",
      organizationId: ORG,
      subjectKey: subjectKeyForEquipment("eq_2"),
      subjectName: "Витрина",
      equipmentId: "eq_2",
      documentId: null,
      responsibleUserId: "user_resp",
      firstValue: 9,
      lastValue: 9,
      tempMin: 0,
      tempMax: 2,
      notifiedAt: new Date(NOW.getTime() - 10 * 60000),
      escalatedAt: null,
      resolvedAt: null,
    },
  ];
  const { deps, rec } = fakeDeps({
    responsible: RESPONSIBLE,
    minutes: 60,
    seed,
  });

  const result = await escalateOpenIncidents(
    { now: NOW },
    { ...deps, listOpenIncidents: async () => seed }
  );

  assert.equal(result.checked, 2);
  assert.equal(result.escalated, 1);
  assert.deepEqual(rec.escalatedIds, ["inc_old"]);
  assert.equal(rec.managementMessages.length, 1);
  assert.match(rec.managementMessages[0].text, /Морозильный ларь/);
});

test("escalateOpenIncidents пропускает закрытые после своих 14 дней организации", async () => {
  const overdue = (id: string, organizationId: string): DeviationIncident => ({
    id,
    organizationId,
    subjectKey: subjectKeyForEquipment(`eq_${id}`),
    subjectName: "Морозильный ларь",
    equipmentId: `eq_${id}`,
    documentId: null,
    responsibleUserId: "user_resp",
    firstValue: -5,
    lastValue: -5,
    tempMin: null,
    tempMax: -18,
    notifiedAt: new Date(NOW.getTime() - 120 * 60000),
    escalatedAt: null,
    resolvedAt: null,
  });
  const seed = [overdue("inc_open", ORG), overdue("inc_locked", "org_locked")];
  const { deps, rec } = fakeDeps({ responsible: RESPONSIBLE, minutes: 60, seed });

  const result = await escalateOpenIncidents(
    { now: NOW, skipOrganizationIds: new Set(["org_locked"]) },
    { ...deps, listOpenIncidents: async () => seed }
  );

  assert.equal(result.checked, 1);
  assert.deepEqual(rec.escalatedIds, ["inc_open"]);
});

test("закрытие эскалированного инцидента сообщает и руководству", async () => {
  const seed: DeviationIncident[] = [
    {
      id: "inc_esc",
      organizationId: ORG,
      subjectKey: subjectKeyForEquipment("eq_1"),
      subjectName: "Холодильник №3",
      equipmentId: "eq_1",
      documentId: null,
      responsibleUserId: "user_resp",
      firstValue: 9,
      lastValue: 9,
      tempMin: 2,
      tempMax: 6,
      notifiedAt: new Date(NOW.getTime() - 120 * 60000),
      escalatedAt: new Date(NOW.getTime() - 60 * 60000),
      resolvedAt: null,
    },
  ];
  const { deps, rec } = fakeDeps({ responsible: RESPONSIBLE, seed });

  const result = await processTemperatureReading(reading({ value: 4 }), deps);

  assert.equal(result.action, "resolved");
  assert.equal(rec.managementMessages.length, 1);
  assert.match(rec.managementMessages[0].text, /вернулась в норму/);
});

test("ошибка в зависимостях не роняет запись в журнал", async () => {
  const { deps } = fakeDeps({ responsible: RESPONSIBLE });
  const broken: Deps = {
    ...deps,
    findOpenIncident: async () => {
      throw new Error("db down");
    },
  };

  const result = await processTemperatureReading(reading(), broken);

  assert.equal(result.action, "noop");
});
