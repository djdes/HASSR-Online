/* eslint-disable react/no-children-prop -- Explicit providers for isolated component rendering. */
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import { validateCatalog } from "@/i18n/catalog-validation";
import type { Locale } from "@/i18n/locales";
import { PerishableRejectionDocumentClient } from "./perishable-rejection-document-client";
import { PerishableRejectionDocumentsClient } from "./perishable-rejection-documents-client";
import { perishableCell, perishableColumn, perishableSignatureLines, perishableTitle } from "./perishable-rejection-presentation";
import { normalizePerishableRejectionConfig, PERISHABLE_REJECTION_DOCUMENT_TITLE, PERISHABLE_ORGANOLEPTIC_VALUES, addHoursToLocalDateTime } from "@/lib/perishable-rejection-document";
import { resolveColumns } from "@/lib/journal-columns";

const users = [{ id: "employee-1", name: "O‘tkir", role: "cook" }];
const config = normalizePerishableRejectionConfig({ rows: [{ id: "original-row", productName: "Custom O‘rik", arrivalDate: "2026-10-15", arrivalTime: "23:30", productionDate: "2026-10-14", manufacturer: "Original manufacturer", supplier: "Original supplier", packaging: "Custom package", quantity: "20 кг", documentNumber: "CERT-001", organolepticResult: "poor_quality", storageCondition: "minus18", expiryDate: "2026-10-16", expiryTime: "11:30", responsiblePerson: "Имя, Своя должность", note: "Original note", signatures: [{ userId: "signer", name: "Original signer", role: "Председатель", signedAt: "2026-10-15T07:00:00Z", method: "session" }] }], productLists: [{ id: "list-1", name: "Original list", items: ["Original item"] }], manufacturers: ["Original manufacturer"], suppliers: ["Original supplier"], showNote: true });
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
async function render(locale: Locale, children: ReactNode) {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router, children: createElement(SearchParamsContext.Provider, { value: new URLSearchParams(), children: createElement(NextIntlClientProvider, { locale, messages: await loadMessages(locale), timeZone: "UTC", onError: error => { throw error; }, children }) }) })).replaceAll("&#x27;", "'");
}

test("perishable actual list/detail active, closed and empty views render all three locales", async () => {
  const before = JSON.stringify(config);
  for (const locale of ["ru", "en", "uz"] as const) {
    const m = (await loadMessages(locale)).perishableRejection;
    assert.deepEqual(validateCatalog((await loadMessages("ru")).perishableRejection, m), []);
    for (const status of ["active", "closed"] as const) {
      const list = await render(locale, createElement(PerishableRejectionDocumentsClient, { activeTab: status, templateCode: "perishable_rejection", templateName: PERISHABLE_REJECTION_DOCUMENT_TITLE, users, documents: [{ id: "doc-1", title: PERISHABLE_REJECTION_DOCUMENT_TITLE, status, dateFrom: "2026-10-01", startedAtLabel: "legacy date", config }] }));
      assert.ok(list.includes(status === "closed" ? m.closedTitle : m.title));
      assert.ok(!list.includes("legacy date"));
      for (const rows of [config.rows, []]) {
        const html = await render(locale, createElement(PerishableRejectionDocumentClient, { documentId: "doc-1", title: PERISHABLE_REJECTION_DOCUMENT_TITLE, organizationName: "Original organization", dateFrom: "2026-10-01", status, initialConfig: { ...config, rows }, users }));
        for (const expected of [m.title, m.columns.document, m.columns.supplier]) assert.ok(html.includes(expected), `${locale}: ${expected}`);
        if (rows.length) for (const expected of [m.organoleptic.poor_quality, m.storage.minus18, m.signatures.title, "Custom O‘rik", "Original signer", "Председатель", "Имя, Своя должность", "20 кг"]) assert.ok(html.includes(expected), `${locale}: ${expected}`);
        if (locale !== "ru") assert.doesNotMatch(html, /ЖУРНАЛ БРАКЕРАЖА|Не удалось сохранить|Доброкачественно|Недоброкачественно|Дата и час, поступления/);
      }
    }
  }
  assert.equal(JSON.stringify(config), before);
});

test("stable enum and column presentation preserves custom metadata, signed snapshots, expiry calculations and blank cells", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = createTranslator({ locale, messages: await loadMessages(locale), namespace: "perishableRejection", onError: error => { throw error; } });
    for (const organolepticResult of PERISHABLE_ORGANOLEPTIC_VALUES) assert.equal(perishableCell({ ...config.rows[0], organolepticResult }, "organoleptic", locale, t), t(`organoleptic.${organolepticResult}`));
    for (const storageCondition of ["2_6", "minus18", "minus2_2"] as const) assert.ok(perishableCell({ ...config.rows[0], storageCondition }, "storage", locale, t).includes(t(`storage.${storageCondition}`)));
    const custom = { ...config, columns: { labels: { supplier: "Поставщик" }, hidden: [] } };
    const column = resolveColumns("perishable_rejection", custom).find(column => column.key === "supplier")!;
    assert.equal(perishableColumn(column, custom, t).label, "Поставщик", "explicit customer override wins even when identical to the source default");
    assert.equal(perishableTitle("Custom title", "2026-10-01", locale, t), "Custom title");
    assert.equal(perishableCell(config.rows[0], "responsible", locale, t), "Имя, Своя должность");
    const signatures = perishableSignatureLines(config.rows, locale, t, "Asia/Tashkent").join("\n");
    assert.ok(signatures.includes("12:00") && signatures.includes("Original signer (Председатель)"));
    assert.ok(perishableSignatureLines(config.rows, locale, t).join("\n").includes("10:00"), "default Moscow timezone retained");
    assert.equal(perishableCell({ ...config.rows[0], expiryDate: "", expiryTime: "17:00" }, "storage", locale, t), t("storage.minus18"), "undated expiry time remains hidden as before");
    assert.deepEqual(addHoursToLocalDateTime("2026-10-15", "23:30", 12), { date: "2026-10-16", time: "11:30" });
  }
});
