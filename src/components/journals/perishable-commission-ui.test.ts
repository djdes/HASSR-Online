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
import type { Locale } from "@/i18n/locales";
import { PerishableRejectionDocumentClient } from "./perishable-rejection-document-client";
import { perishableCloseBlocker, perishableCommissionStatus, perishableTodaySignatures } from "./perishable-rejection-presentation";
import { normalizePerishableRejectionConfig, PERISHABLE_REJECTION_DOCUMENT_TITLE } from "@/lib/perishable-rejection-document";
import { renderBrakerageList, renderCommissionGate } from "@/lib/brakerage-qr-html";

/**
 * Бракеражная комиссия скоропорта (AC4): документ с меткой сервера
 * `commissionEnabled` показывает кнопку «Комиссия · N», строку состава,
 * статус подписи у записи и блок «Подписи бракеражной комиссии»; старая
 * копия состава без метки — как документ без комиссии. QR-список для
 * члена комиссии — про позиции, комментарий обязателен только к отказу.
 */
const member = { id: "commission-u1", role: "Председатель", roleKind: "chair" as const, employeeId: "u1", employeeName: "Лебедева Марина Олеговна" };
const rows = [
  { id: "r1", productName: "Сметана 20%", arrivalDate: "2026-10-17", arrivalTime: "08:10", organolepticResult: "compliant" },
  {
    id: "r2",
    productName: "Творог 9%",
    arrivalDate: "2026-10-17",
    arrivalTime: "08:20",
    organolepticResult: "compliant",
    signatures: [{ userId: "u1", name: "Лебедева Марина Олеговна", role: "Председатель", signedAt: "2026-10-17T06:00:00.000Z", method: "qr", grade: "compliant" }],
  },
];
const enabled = normalizePerishableRejectionConfig({ rows, commissionMembers: [member], commissionEnabled: true });
const legacy = normalizePerishableRejectionConfig({ rows, commissionMembers: [member] });
const users = [{ id: "u1", name: "Лебедева Марина Олеговна", role: "technologist" }];
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function render(locale: Locale, children: ReactNode) {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router, children: createElement(SearchParamsContext.Provider, { value: new URLSearchParams(), children: createElement(NextIntlClientProvider, { locale, messages: await loadMessages(locale), timeZone: "UTC", onError: error => { throw error; }, children }) }) })).replaceAll("&#x27;", "'");
}
const doc = (initialConfig: typeof enabled, currentUserId: string | null = null) =>
  createElement(PerishableRejectionDocumentClient, { documentId: "doc-1", title: PERISHABLE_REJECTION_DOCUMENT_TITLE, organizationName: "Org", dateFrom: "2026-10-01", status: "active", initialConfig, users, currentUserId });

test("документ скоропорта с комиссией: кнопка «Комиссия · 1», состав, статусы записей, блок подписей", async () => {
  const html = await render("ru", doc(enabled));
  assert.match(html, /data-testid="perishable-commission-button"[^>]*>[\s\S]*?Комиссия · 1/);
  assert.ok(html.includes("Бракеражная комиссия: Лебедева М. О. (Председатель)"));
  assert.ok(html.includes("Ждёт подписи комиссии"));
  assert.match(html, /Подписано: Лебедева М\. О\. · \d{2}:\d{2}/);
  assert.ok(html.includes("Подписи бракеражной комиссии<"), "заголовок блока подписей для действующей комиссии");
  assert.ok(!html.includes("сохранены из прежней формы журнала"));
});

test("старая копия состава без метки сервера — документ без комиссии", async () => {
  assert.deepEqual(legacy.commissionMembers, []);
  const html = await render("ru", doc(legacy));
  assert.ok(!html.includes("data-testid=\"perishable-commission-status\""));
  assert.ok(!html.includes("Бракеражная комиссия:"));
  assert.ok(html.includes("сохранены из прежней формы журнала"), "прежние подписи — под старым заголовком");
});

test("член комиссии видит документ без ошибок во всех языках", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const html = await render(locale, doc(enabled, "u1"));
    const m = (await loadMessages(locale)).perishableRejection;
    assert.ok(html.includes(m.commission.waiting), `${locale}: статус`);
    assert.ok(html.includes(m.signatures.commissionTitle), `${locale}: блок подписей`);
  }
});

test("окно закрытия и плашка «Сегодня» скоропорта", async () => {
  const t = createTranslator({ locale: "ru", messages: await loadMessages("ru"), namespace: "perishableRejection", onError: error => { throw error; } });
  const blocker = perishableCloseBlocker(enabled, t);
  assert.ok(blocker);
  assert.equal(blocker.title, "Нельзя закончить журнал: 1 запись ждёт подписи комиссии");
  assert.deepEqual(blocker.bullets, ["Сметана 20% · 17.10"]);
  assert.equal(perishableCloseBlocker(legacy, t), null, "старая копия без метки закрытию не мешает");
  assert.equal(perishableTodaySignatures({ total: 2, waiting: 1 }, true, t), "Сегодня: 2 записи, 1 ждёт подписи комиссии — выделите их и нажмите «Подписать»");
  assert.equal(perishableTodaySignatures({ total: 2, waiting: 0 }, false, t), "Сегодня: 2 записи, все подписаны комиссией");
  assert.deepEqual(perishableCommissionStatus(enabled.rows[0], t), { signed: false, text: "Ждёт подписи комиссии" });
});

test("QR скоропорта: список позиций для члена комиссии, комментарий — только к отказу", () => {
  const html = renderBrakerageList({
    action: "/journal-fill/org/perishable_rejection?token=t",
    who: "",
    tabs: "",
    list: {
      showPortion: false,
      gradeOptions: ["compliant", "non_compliant"].map((value) => ({ value, label: value })),
      rows: [{ documentId: "d1", rowId: "r1", name: "Сметана 20%", time: "08:10", rejectionTime: "", rejectionAt: "", dayKey: "2026-10-17", fromYesterday: false, grade: "compliant", releaseAllowed: null, portionWeight: "", note: "", signatures: [] }],
    },
    role: { evaluator: true, editor: false, viewer: false },
    employeeId: "u1",
    isFinished: false,
    timeZone: "Europe/Moscow",
    addHref: "#",
    deleteHref: () => "#",
  });
  assert.ok(html.includes("Позиций в очереди: <b>1</b>"));
  assert.ok(html.includes("Комментарий (обязателен, если позиция не соответствует)"));
  assert.ok(html.includes('grade.value==="non_compliant"||grade.value==="poor_quality"'));
  assert.ok(!html.includes("кроме «Отлично»"));
  assert.ok(html.includes("Ждёт подписи"));
  assert.ok(renderCommissionGate({ loginHref: "/login", pinHref: "?commission=1", isFinished: false }).includes("подписать поступившие позиции по своему PIN"));
  assert.ok(renderCommissionGate({ loginHref: "/login", pinHref: "?commission=1" }).includes("подписать блюда по своему PIN"));
});
