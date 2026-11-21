import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadMessages } from "@/i18n/messages";
import {
  IIKO_SETTINGS_HREF,
  MERCURY_INCOMING_HREF,
  SUPPLY_INBOX_HREF,
  SUPPLY_ROWS_TEMPLATE_CODE,
  iikoTarget,
  mercuryPendingWhere,
  receivesSupplyRows,
  showMercuryStrip,
} from "@/lib/acceptance-sources";
import { ACCEPTANCE_DOCUMENT_TEMPLATE_CODES, RAW_MATERIAL_ACCEPTANCE_TEMPLATE_CODE } from "@/lib/acceptance-document";
import { loadAcceptanceSources, type AcceptanceSourcesDeps } from "@/lib/acceptance-sources.server";

/**
 * Меркурий и iiko в журнале приёмки (спека mercury-iiko-acceptance-2026-11-21).
 */

const NOW = new Date("2026-11-21T12:00:00Z");

function fakeDeps(state: {
  plan?: boolean;
  integration?: { enabled: boolean } | null;
  iiko?: boolean;
  pending?: number;
  overdue?: number;
}) {
  const calls: Array<Parameters<AcceptanceSourcesDeps["countVetDocuments"]>[0]> = [];
  let touched = 0;
  const deps: AcceptanceSourcesDeps = {
    planHasMercury: async () => { touched += 1; return state.plan ?? true; },
    mercuryIntegration: async () => { touched += 1; return state.integration === undefined ? { enabled: true } : state.integration; },
    iikoConnection: async () => { touched += 1; return state.iiko ? { id: "conn" } : null; },
    countVetDocuments: async (where) => {
      calls.push(where);
      return where.processingDueAt ? state.overdue ?? 0 : state.pending ?? 0;
    },
  };
  return { deps, calls, touched: () => touched };
}

const base = { organizationId: "org-1", buildingId: "b-1", canManage: true, now: NOW };

test("AC1: нет интеграции, она выключена или Меркурия нет в тарифе — подсказки нет", async () => {
  for (const state of [{ integration: null }, { integration: { enabled: false } }, { plan: false }]) {
    const { deps, calls } = fakeDeps({ ...state, pending: 5 });
    const sources = await loadAcceptanceSources(base, deps);
    assert.equal(sources?.mercury, null, JSON.stringify(state));
    assert.equal(calls.length, 0, "без Меркурия ВСД не считаем");
  }
});

test("AC1: включён и в тарифе — счёт ожидающих и просроченных на точке документа", async () => {
  const { deps, calls } = fakeDeps({ pending: 4, overdue: 1 });
  const sources = await loadAcceptanceSources(base, deps);
  assert.deepEqual(sources?.mercury, { pending: 4, overdue: 1 });
  assert.deepEqual(calls[0], mercuryPendingWhere("org-1", "b-1"));
  assert.deepEqual(calls[1], { ...mercuryPendingWhere("org-1", "b-1"), processingDueAt: { lt: NOW } });
});

test("AC1: фильтр — статусы «Входящих ВСД», своя организация, точка документа и общие", () => {
  assert.deepEqual(mercuryPendingWhere("org-1", "b-1"), {
    organizationId: "org-1",
    OR: [{ buildingId: "b-1" }, { buildingId: null }],
    localStatus: { in: ["new", "acknowledged"] },
  });
  assert.deepEqual(mercuryPendingWhere("org-1", null), {
    organizationId: "org-1",
    localStatus: { in: ["new", "acknowledged"] },
  });
  const vsdPage = readFileSync(new URL("../app/(dashboard)/mercury/incoming-vsd-client.tsx", import.meta.url), "utf8");
  assert.match(vsdPage, /\["new", "acknowledged"\]\.includes\(d\.localStatus\)/, "те же статусы, что считает экран «Входящие ВСД»");
});

test("AC1: не руководитель — null и ни одного запроса; полоса только когда есть что оформлять", async () => {
  const { deps, touched } = fakeDeps({ pending: 3 });
  assert.equal(await loadAcceptanceSources({ ...base, canManage: false }, deps), null);
  assert.equal(touched(), 0);
  assert.equal(showMercuryStrip(null), false);
  assert.equal(showMercuryStrip({ mercury: null, iikoConnected: true }), false);
  assert.equal(showMercuryStrip({ mercury: { pending: 0, overdue: 0 }, iikoConnected: false }), false, "пусто — без полосы");
  assert.equal(showMercuryStrip({ mercury: { pending: 2, overdue: 0 }, iikoConnected: false }), true);
});

test("AC1: журнал получает подсказку только для руководства, полоса и пункт меню — по ней", () => {
  const page = readFileSync(new URL("../app/(dashboard)/journals/[code]/documents/[docId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /receivesSupplyRows\(document\.template\.code\)\s*\?\s*await loadAcceptanceSources\(\{\s*organizationId: getActiveOrgId\(session\),\s*buildingId: document\.buildingId,\s*canManage: hasFullWorkspaceAccess\(session\.user\),/);
  assert.match(page, /sources=\{acceptanceSources\}/);
  const client = readFileSync(new URL("../components/journals/acceptance-document-client.tsx", import.meta.url), "utf8");
  assert.match(client, /showMercuryStrip\(props\.sources\)/);
  assert.match(client, /\.\.\.\(props\.sources\?\.mercury\s*\?\s*\[\s*\{\s*key: "add-mercury"/);
  assert.match(client, /\.\.\.\(props\.sources\s*\?\s*\[\s*\{\s*key: "add-iiko"/);
  assert.equal(MERCURY_INCOMING_HREF, "/mercury");
});

test("AC2: «Из iiko» ведёт во «Входящие накладные» или в настройки iiko по факту подключения", async () => {
  assert.deepEqual(iikoTarget(true), { href: SUPPLY_INBOX_HREF, kind: "inbox" });
  assert.deepEqual(iikoTarget(false), { href: IIKO_SETTINGS_HREF, kind: "connect" });
  assert.equal(SUPPLY_INBOX_HREF, "/edo");
  assert.equal(IIKO_SETTINGS_HREF, "/settings/integrations/iiko");
  const { deps } = fakeDeps({ iiko: true, integration: null });
  assert.equal((await loadAcceptanceSources(base, deps))?.iikoConnected, true);
  const none = fakeDeps({ iiko: false });
  assert.equal((await loadAcceptanceSources(base, none.deps))?.iikoConnected, false);
});

test("AC2/AC4: тексты Меркурия и iiko на ru, en, uz; «обратитесь к разработчикам» в журнале больше нет", async () => {
  const banned = [/разработчик/i, /developers/i, /ishlab chiqvchi/i];
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const iiko = messages.journalAcceptance.iiko as Record<string, string>;
    assert.deepEqual(Object.keys(iiko).sort(), ["connect", "connected", "notConnected", "openInbox", "title"], locale);
    for (const [key, value] of Object.entries(iiko)) {
      assert.ok(value.trim(), `${locale}: iiko.${key}`);
      for (const pattern of banned) assert.doesNotMatch(value, pattern, `${locale}: iiko.${key}`);
    }
    const mercury = messages.journalAcceptance.mercury;
    for (const key of ["menu", "pending", "overdue", "hint", "process"] as const) {
      assert.ok(mercury[key].trim(), `${locale}: mercury.${key}`);
    }
    assert.match(mercury.pending, /\{count, (plural|number)/, `${locale}: счёт ВСД`);
    assert.match(mercury.overdue, /\{count, number\}/, `${locale}: просрочено`);
  }
});

test("AC1/AC2: подсказки — только в журнале, куда ложатся строки ВСД и накладных, не в журнале сырья", () => {
  assert.ok((ACCEPTANCE_DOCUMENT_TEMPLATE_CODES as readonly string[]).includes(SUPPLY_ROWS_TEMPLATE_CODE));
  assert.equal(receivesSupplyRows(SUPPLY_ROWS_TEMPLATE_CODE), true);
  assert.equal(receivesSupplyRows(RAW_MATERIAL_ACCEPTANCE_TEMPLATE_CODE), false);
  const vsd = readFileSync(new URL("./mercury/process-incoming.ts", import.meta.url), "utf8");
  assert.match(vsd, new RegExp(`const ACCEPTANCE_TEMPLATE_CODE = "${SUPPLY_ROWS_TEMPLATE_CODE}"`), "строка ВСД — в этот журнал");
  const supply = readFileSync(new URL("./supply/documents.server.ts", import.meta.url), "utf8");
  assert.match(supply, new RegExp(`export const ACCEPTANCE_TEMPLATE_CODE = "${SUPPLY_ROWS_TEMPLATE_CODE}"`), "накладная — в этот журнал");
});
