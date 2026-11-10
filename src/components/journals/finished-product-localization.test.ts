/* eslint-disable react/no-children-prop -- SSR provider fixtures use createElement. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import { FinishedProductDocumentClient } from "./finished-product-document-client";
import { FinishedProductDocumentsClient } from "./finished-product-documents-client";
import { FinishedProductPipeline } from "./finished-product-pipeline";
import { FinishedProductBulkTable } from "./finished-product-bulk-dialog";
import { finishedCell, finishedColumn, finishedGrade, finishedTitle, finishedChainCaption, finishedCloseBlocker } from "./finished-product-presentation";
import { normalizeFinishedProductDocumentConfig, FINISHED_PRODUCT_DOCUMENT_TITLE, finishedProductReleaseText } from "@/lib/finished-product-document";
import { resolveColumns } from "@/lib/journal-columns";
import { unsignedRows, formatRowSignatures, normalizeRowSignatures } from "@/lib/brakerage-commission";

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const users = [{ id: "employee-1", name: "O‘tkir", role: "cook" }];
const config = normalizeFinishedProductDocumentConfig({ rows: [{ id: "row-1", productName: "Custom O‘tkir dish", productionDateTime: "2026-10-15 10:00", rejectionTime: "2026-10-15 10:05", releaseAllowed: "yes", releasePermissionTime: "2026-10-15 10:10", organoleptic: "Отлично", portionWeight: "200/10", note: "User original note" }], footerNote: "Custom footer", commissionMembers: [] });
async function render(locale: Locale, children: ReactNode) {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router, children: createElement(SearchParamsContext.Provider, { value: new URLSearchParams(), children: createElement(NextIntlClientProvider, { locale, messages: await loadMessages(locale), timeZone: "UTC", onError: error => { throw error; }, children }) }) }));
}

test("finished-product actual list/detail/bulk/pipeline render three languages with unchanged row values", async () => {
  const before = JSON.stringify(config);
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = (await loadMessages(locale)).finishedProduct;
    for (const status of ["active", "closed"] as const) {
      const list = await render(locale, createElement(FinishedProductDocumentsClient, { activeTab: status, templateCode: "finished_product", templateName: FINISHED_PRODUCT_DOCUMENT_TITLE, users, documents: [{ id: "document-1", title: FINISHED_PRODUCT_DOCUMENT_TITLE, dateFrom: "2026-10-01", dateTo: "2026-10-31", status, responsibleTitle: "O‘tkir", periodLabel: "Legacy period", startedAtLabel: "Legacy date", config }] }));
      assert.ok(list.includes(messages.title));
      assert.ok(list.includes("O‘tkir"));
      const detail = await render(locale, createElement(FinishedProductDocumentClient, { documentId: "doc-1", title: FINISHED_PRODUCT_DOCUMENT_TITLE, organizationName: "Org original", dateFrom: "2026-10-01", dateTo: "2026-10-31", status, initialConfig: config, users }));
      for (const expected of [messages.title, messages.columns.organoleptic, messages.grades.excellent, "Custom O‘tkir dish", "User original note", "200/10", "Custom footer"]) assert.ok(detail.includes(expected), `${locale}: ${expected}`);
      if (locale !== "ru") assert.doesNotMatch(detail, /Журнал бракеража|Результаты органолептической|Закончить журнал|Настройки документа/);
    }
    const empty = await render(locale, createElement(FinishedProductDocumentClient, { documentId: "empty", title: FINISHED_PRODUCT_DOCUMENT_TITLE, organizationName: "Org", dateFrom: "2026-10-01", dateTo: "2026-10-31", status: "active", initialConfig: { ...config, rows: [] }, users }));
    assert.ok(empty.includes(messages.title));
    const pipeline = await render(locale, createElement(FinishedProductPipeline, {}));
    assert.ok(pipeline.includes(messages.pipeline.product));
    const bulk = await render(locale, createElement(FinishedProductBulkTable, { rows: [{ name: "Dish unchanged", yield: "200/10", time: "08:30" }], maxRows: 50, showYield: true, showTime: true, onRowsChange() {} }));
    assert.ok(bulk.includes("Dish unchanged") && bulk.includes("08:30"));
    assert.ok(bulk.includes(messages.bulk.pasteAll));
    if (locale !== "ru") assert.doesNotMatch(pipeline + bulk, /Что готовим|Наименование|Ещё строка|За сегодня/);
  }
  assert.equal(JSON.stringify(config), before);
});

test("finished-product presentation never rewrites custom metadata, grades, release codes or signature clocks", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = createTranslator({ locale, messages: await loadMessages(locale), namespace: "finishedProduct", onError: error => { throw error; } });
    assert.equal(finishedGrade("Отлично", config, t), t("grades.excellent"));
    assert.equal(finishedGrade("Отлично", { organolepticOptions: ["Отлично"] }, t), "Отлично");
    assert.equal(finishedGrade("Unlisted custom wording", config, t), "Unlisted custom wording");
    const custom = { ...config, columns: { labels: { name: "Наименование готового блюда" }, hidden: [] } };
    const column = resolveColumns("finished_product", custom).find(column => column.key === "name")!;
    assert.equal(finishedColumn(column, custom, t).label, "Наименование готового блюда", "explicit customer override wins even if matching Russian default");
    assert.equal(finishedTitle("Customer title", "2026-10-01", "2026-10-31", locale, t), "Customer title");
    assert.equal(finishedCell(config.rows[0], "name", config, t), config.rows[0].productName);
    assert.equal(finishedCell(config.rows[0], "release", config, t), t("releaseAt", { time: "10:10" }));
    assert.equal(finishedProductReleaseText(config.rows[0]), "Разрешено, 10:10");
    assert.match(finishedChainCaption({ productionDateTime: "2026-10-15 23:58", offsets: { rejectionAfterProductionMinutes: 5, releaseAfterRejectionMinutes: 5 } }, t), /00:03.*00:08/);
    const signed = { ...config.rows[0], signatures: [{ userId: "employee-1", name: "O‘tkir", signedAt: "2026-10-15T07:06:00Z", journalAt: "2026-10-15 10:06", role: "Custom role", method: "session", releaseAllowed: "yes" }] };
    assert.equal(finishedCell(signed, "signatures", config, t), formatRowSignatures(normalizeRowSignatures(signed.signatures), undefined, signed));
    const waiting = { commissionMembers: [{}], rows: [config.rows[0]] };
    assert.equal(unsignedRows(waiting).length, 1);
    assert.ok(finishedCloseBlocker(waiting, t)?.title.includes("1"));
    assert.equal(finishedCloseBlocker({ ...waiting, rows: [signed] }, t), null);
  }
});
