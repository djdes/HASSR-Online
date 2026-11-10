/* eslint-disable react/no-children-prop -- React 19 provider typings require children in props. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { CapaForm, DEFAULT_PRIORITY, PRIORITY_SLA_HOURS } from "./capa-form";
import { CapaWorkflow } from "./capa-workflow";
import { CapaAutoDetectButton } from "./auto-detect-button";
import {
  CAPA_STATUSES, CAPA_PRIORITIES, CAPA_CATEGORIES, CAPA_TEMPLATES, CAPA_ERROR_CODES,
  capaWorkflowPayload, capaWorkflowStep, capaErrorKey, readCapaFormData, capaSuggestionLanguageInstruction,
} from "./capa-presentation";
import { capaSuggestionErrorResponse } from "./capa-suggestion-copy";
import { loadMessages } from "@/i18n/messages";
import type { MessageContract } from "@/i18n/message-contract";
import { resolveExportLocale } from "@/i18n/export-locale";

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

test("CAPA form, detector and all workflow stages render real RU/EN/UZ messages", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, {
      locale, messages, timeZone: "Europe/Moscow", onError: error => { throw error; },
      children: createElement(AppRouterContext.Provider, {
        value: router,
        children: createElement(Fragment, null,
          createElement(CapaForm, { users: [{ id: "user-custom-id", name: "Anvar Example" }] }),
          createElement(CapaAutoDetectButton),
          ...CAPA_STATUSES.map(currentStatus => createElement(CapaWorkflow, { key: currentStatus, ticketId: "ticket-original-id", currentStatus })),
          createElement(CapaWorkflow, { ticketId: "ticket-original-id", currentStatus: "__proto__" }),
        ),
      }),
    }));
    for (const text of [messages.capaManagement.form.title, messages.capaManagement.form.create,
      messages.capaManagement.detect.button, messages.capaManagement.workflow.open.label,
      messages.capaManagement.workflow.investigating.label, messages.capaManagement.workflow.corrective_action.label,
      messages.capaManagement.workflow.verification.label]) assert.ok(html.includes(text), text);
    assert.ok(html.includes('name="title"'));
    assert.ok(html.includes('name="description"'));
    assert.ok(html.includes('id="capa-ticket-original-id-rootCause"'));
    if (locale !== "ru") assert.doesNotMatch(html, /\p{Script=Cyrillic}/u);
  }
});

test("CAPA preset copy translates while SLA, category and priority codes remain stable", async () => {
  assert.equal(DEFAULT_PRIORITY, "medium");
  assert.equal(PRIORITY_SLA_HOURS[DEFAULT_PRIORITY], "48");
  const sources = (await loadMessages("ru")).capaManagement.templates;
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages: messages as MessageContract, namespace: "capaManagement", onError: error => { throw error; } });
    for (const preset of CAPA_TEMPLATES) {
      assert.ok(t(`templates.${preset.id}.label`));
      assert.ok(t(`templates.${preset.id}.title`));
      const description = t(`templates.${preset.id}.description`);
      assert.ok(description.includes("\n"), "editable template structure remains multiline");
      assert.deepEqual((description.match(/\d+/g) ?? []).sort(), (sources[preset.id].description.match(/\d+/g) ?? []).sort(), `${locale}.${preset.id} values`);
      assert.equal(preset.slaHours, PRIORITY_SLA_HOURS[preset.priority]);
      if (locale !== "ru") assert.doesNotMatch(description, /\p{Script=Cyrillic}/u);
    }
    for (const status of CAPA_STATUSES) assert.ok(t(`statuses.${status}`));
    for (const category of CAPA_CATEGORIES) assert.ok(t(`categories.${category}`));
    for (const priority of CAPA_PRIORITIES) assert.match(t(`prioritySla.${priority}`, { hours: Number(PRIORITY_SLA_HOURS[priority]) }), new RegExp(PRIORITY_SLA_HOURS[priority]));
    for (const hours of [1, 2, 24, 48, 72]) assert.match(t("hours", { hours }), new RegExp(String(hours)));
    assert.ok(t("detect.createdWithSkipped", { created: 2, skipped: 5 }).includes("2"));
    assert.ok(t("detect.createdWithSkipped", { created: 2, skipped: 5 }).includes("5"));
    assert.ok(t("slaBreached", { deadline: "2026-10-15 23:59" }).includes("2026-10-15 23:59"));
  }
});

test("CAPA request and workflow payloads retain user text, identity and existing transitions", () => {
  const form = new FormData();
  form.set("title", "Проблема O‘zbekcha");
  form.set("description", "Original\nПользовательский текст");
  const payload = readCapaFormData(form, { priority: "critical", category: "process", slaHours: "2", assignedToId: "user-original-id" });
  assert.deepEqual(payload, { title: "Проблема O‘zbekcha", description: "Original\nПользовательский текст", priority: "critical", category: "process", slaHours: 2, assignedToId: "user-original-id", dueDate: null });
  assert.deepEqual(capaWorkflowPayload("open", "Исходное наблюдение"), { status: "investigating", rootCause: "Исходное наблюдение" });
  assert.deepEqual(capaWorkflowPayload("investigating", "Asl sabab"), { status: "corrective_action", rootCause: "Asl sabab" });
  assert.deepEqual(capaWorkflowPayload("corrective_action", "Corrective action"), { status: "verification", correctiveAction: "Corrective action" });
  assert.deepEqual(capaWorkflowPayload("verification", ""), { status: "closed", verificationResult: undefined });
  assert.equal(capaWorkflowPayload("closed", "unchanged"), null);
  assert.equal(capaWorkflowStep("__proto__"), null);
});

test("CAPA suggestion errors expose stable codes and localized compatible error fields", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    for (const code of Object.keys(CAPA_ERROR_CODES) as (keyof typeof CAPA_ERROR_CODES)[]) {
      const response = await capaSuggestionErrorResponse(code, locale);
      const body = await response.json();
      assert.equal(body.code, code);
      assert.equal(body.error, messages.capaManagement.errors[CAPA_ERROR_CODES[code]]);
      assert.equal(capaErrorKey(body.error, response.status, body.code), CAPA_ERROR_CODES[code]);
      assert.equal(response.headers.get("Content-Language"), locale);
      assert.match(response.headers.get("Cache-Control") ?? "", /private, no-store/);
      assert.ok(response.status >= 400);
      if (locale !== "ru") assert.doesNotMatch(body.error, /\p{Script=Cyrillic}/u);
    }
  }
  assert.equal(capaErrorKey("Заголовок обязателен"), "titleRequired");
  assert.equal(capaErrorKey("Сотрудник не найден", 404), "assigneeNotFound");
  assert.equal(capaErrorKey("Internal database details", 500, undefined, "detectFailed"), "detectFailed");
  assert.equal(capaErrorKey("__proto__", 500, "__proto__", "suggestFailed"), "suggestFailed");
});

test("CAPA generated suggestions capture explicit locale without changing regulatory context", () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    assert.equal(resolveExportLocale(locale, { locale: "ru", organizationLocale: "en" }), locale);
    const instruction = capaSuggestionLanguageInstruction(locale);
    assert.match(instruction, /Keep JSON property names unchanged/);
    assert.match(instruction, /numeric values and the existing regulatory context/);
    assert.match(instruction, new RegExp({ ru: "Russian", en: "English", uz: "Uzbek using the Latin alphabet" }[locale]));
  }
  assert.equal(resolveExportLocale(null, { locale: "uz", organizationLocale: "en" }), "uz");
  assert.equal(resolveExportLocale(null, { locale: null, organizationLocale: "en" }), "en");
  assert.equal(resolveExportLocale("__proto__", { locale: "uz" }), null);
});
