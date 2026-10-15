/* eslint-disable react/no-children-prop -- SSR provider children are passed through createElement. */
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
import { EquipmentCalibrationDocumentClient } from "./equipment-calibration-document-client";
import { EquipmentCalibrationDocumentsClient } from "./equipment-calibration-documents-client";
import { calibrationDate, calibrationDocumentTitle, calibrationErrorKey, calibrationPositionLabel, checkCalibrationResponse } from "./equipment-calibration-presentation";
import { calculateNextCalibrationDate, EQUIPMENT_CALIBRATION_DOCUMENT_TITLE, normalizeEquipmentCalibrationConfig } from "@/lib/equipment-calibration-document";

const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const config = normalizeEquipmentCalibrationConfig({ year: 2026, documentDate: "2026-02-03", approveRole: "Управляющий", approveEmployeeId: "employee-1", approveEmployee: "O‘tkir", rows: [{ id: "row-1", sourceEquipmentId: "equipment-1", equipmentName: "Stored Scale", equipmentNumber: "SN-01", location: "Kitchen A", purpose: "Custom purpose", measurementRange: "20...500 kg", calibrationInterval: 12, lastCalibrationDate: "2025-02-03", note: "Custom note" }] });
const users = [{ id: "employee-1", name: "O‘tkir", role: "manager" }];

async function render(locale: Locale, child: ReactNode) {
  const messages = await loadMessages(locale);
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router, children: createElement(SearchParamsContext.Provider, { value: new URLSearchParams(), children: createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC", onError: error => { throw error; }, children: child }) }) }));
}

test("calibration list and detail render real controls and unchanged user content in all three locales", async () => {
  const before = JSON.stringify(config);
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = (await loadMessages(locale)).equipmentCalibration;
    for (const status of ["active", "closed"] as const) {
      const list = await render(locale, createElement(EquipmentCalibrationDocumentsClient, { activeTab: status, templateCode: "equipment_calibration", templateName: EQUIPMENT_CALIBRATION_DOCUMENT_TITLE, users, documents: [{ id: "document-1", title: EQUIPMENT_CALIBRATION_DOCUMENT_TITLE, status, dateFrom: "2026-01-01", config }] }));
      assert.ok(list.includes(messages.pageTitle));
      assert.ok(list.includes(messages.documentDate));
      assert.ok(list.includes("O‘tkir"));
      assert.ok(list.includes(messages.roles.manager));
      for (const useV2 of [false, true]) {
        const detail = await render(locale, createElement(EquipmentCalibrationDocumentClient, { documentId: "document-1", title: "Custom O‘tkir schedule", organizationName: "Org O‘tkir", dateFrom: "2026-01-01", status, initialConfig: config, users, equipmentDirectory: [{ id: "equipment-1", name: "Live Scale" }], useV2 }));
        for (const text of [messages.characteristics, messages.nextDate, messages.approve, "Live Scale", "SN-01", "Custom purpose", "20...500 kg", "Custom note", "Custom O‘tkir schedule", "Org O‘tkir", "O‘tkir"]) assert.ok(detail.includes(text), locale + " / " + text);
        if (status === "active") assert.match(detail, /aria-label="[^"]*1[^"]*"/);
        if (locale !== "ru") assert.doesNotMatch(detail, /График поверки|Метрологические|Управляющий|мес\./);
      }
    }
    const empty = await render(locale, createElement(EquipmentCalibrationDocumentClient, { documentId: "empty", title: EQUIPMENT_CALIBRATION_DOCUMENT_TITLE, organizationName: "Org", dateFrom: "2026-01-01", status: "active", initialConfig: { ...config, rows: [] }, users }));
    assert.ok(empty.includes(messages.emptyTable));
    assert.ok(empty.includes(messages.pageTitle));
    const emptyList = await render(locale, createElement(EquipmentCalibrationDocumentsClient, { activeTab: "active", templateCode: "equipment_calibration", templateName: EQUIPMENT_CALIBRATION_DOCUMENT_TITLE, users, documents: [] }));
    assert.ok(emptyList.includes(messages.pageTitle));
  }
  assert.equal(JSON.stringify(config), before);
});

test("calibration presentation preserves custom titles, custom roles and UTC month arithmetic", async () => {
  assert.equal(calculateNextCalibrationDate("2024-01-31", 1), "2024-03-02", "existing month-end rollover remains unchanged");
  assert.equal(calculateNextCalibrationDate("2024-02-29", 12), "2025-03-01");
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = (await loadMessages(locale)).equipmentCalibration;
    const t = createTranslator({ locale, messages, onError: error => { throw error; } });
    assert.equal(calibrationPositionLabel("Управляющий", users, messages.roles), messages.roles.manager);
    assert.equal(calibrationPositionLabel("Управляющий", [{ ...users[0], positionTitle: "Управляющий" }], messages.roles), "Управляющий");
    assert.equal(calibrationPositionLabel("Custom role", users, messages.roles), "Custom role");
    assert.equal(calibrationDocumentTitle("Custom title", 2026, locale, t("pageTitle"), (name, period) => t("generatedTitle", { name, period })), "Custom title");
    assert.equal(calibrationDocumentTitle(EQUIPMENT_CALIBRATION_DOCUMENT_TITLE, 2026, locale, t("pageTitle"), (name, period) => t("generatedTitle", { name, period })), t("pageTitle"));
    assert.equal(calibrationDate("", locale), "");
    assert.equal(calibrationDate("invalid", locale), "invalid");
    assert.match(calibrationDate("2026-02-03", locale, true), /2026/);
  }
});

test("calibration HTTP/network errors retain useful meanings without displaying raw API messages", async () => {
  for (const [status, expected] of [[401, "unauthorized"], [403, "forbidden"], [404, "notFound"], [400, "invalid"], [500, "saveJournal"]] as const) {
    await assert.rejects(checkCalibrationResponse(new Response(JSON.stringify({ error: "Internal server detail" }), { status }), "saveJournal"), error => calibrationErrorKey(error, "save") === expected);
  }
  await checkCalibrationResponse(new Response("{}", { status: 200 }), "save");
  assert.equal(calibrationErrorKey(new TypeError("Failed to fetch"), "save"), "network");
  assert.equal(calibrationErrorKey("DOCUMENT_CLOSED", "save"), "closed");
  assert.equal(calibrationErrorKey("Unhandled raw detail", "copy"), "copy");
});
