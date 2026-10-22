import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createTranslator } from "next-intl";
import {
  acceptanceRowToBatchDraft, normalizeAcceptanceDocumentConfig,
} from "@/lib/acceptance-document";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";
import {
  ACCEPTANCE_GENERATED_HEADER_PROFILES, ACCEPTANCE_IMPORT_HEADER_KEYS,
  acceptanceEnumLabel, acceptanceImportHeaders, acceptanceProductColumns,
  acceptanceSummaryDisplay, bindAcceptanceSummaryRows, bindAcceptanceSummarySource,
  captureAcceptanceDiagnostic, captureAcceptanceSummarySource, formatAcceptanceDiagnostic,
  acceptanceCalendarCopy,
  captureAcceptanceOrganizationFallbackSuffix,
  isGeneratedAcceptanceImportHeader, tagAcceptanceError,
  type AcceptanceMessageKey, type AcceptanceTranslate,
} from "./acceptance-document-presentation";

const catalogs = Object.fromEntries(["ru", "en", "uz"].map((locale) => [locale,
  JSON.parse(readFileSync(process.env.ACCEPTANCE_TEST_CATALOG_DIRECTORY ? `${process.env.ACCEPTANCE_TEST_CATALOG_DIRECTORY}/${locale}.json` : new URL(`../i18n/messages/${locale}.json`, import.meta.url), "utf8")),
]));
function translation(locale: string): AcceptanceTranslate {
  return createTranslator({ locale: locale as "ru" | "en" | "uz", messages: catalogs[locale] }) as unknown as AcceptanceTranslate;
}
function leaf(locale: string, key: AcceptanceMessageKey): string {
  return key.split(".").reduce((value, part) => value[part], catalogs[locale]);
}

test("generated EN/UZ protocol profiles bind each of the 22 cells to the exact catalog key", () => {
  for (const product of [true, false]) {
    const kind = product ? "product" : "raw";
    assert.equal(ACCEPTANCE_IMPORT_HEADER_KEYS[kind].length, 11);
    for (const [index, locale] of ["en", "uz"].entries()) {
      const generated = acceptanceImportHeaders(product, translation(locale));
      assert.deepEqual(generated, ACCEPTANCE_IMPORT_HEADER_KEYS[kind].map((key) => leaf(locale, key)));
      assert.deepEqual(ACCEPTANCE_GENERATED_HEADER_PROFILES[kind][index], generated);
      assert.equal(isGeneratedAcceptanceImportHeader(generated, product), true);
      assert.equal(isGeneratedAcceptanceImportHeader(generated, !product), false);
      for (const currentLocale of ["ru", "en", "uz"]) {
        // Recognition has no dependency on the current UI presentation.
        translation(currentLocale);
        assert.equal(isGeneratedAcceptanceImportHeader(generated, product), true);
      }
      assert.equal(isGeneratedAcceptanceImportHeader(generated.slice(1), product), false);
      assert.equal(isGeneratedAcceptanceImportHeader([...generated, ""], product), false);
      assert.equal(isGeneratedAcceptanceImportHeader([...generated].reverse(), product), false);
      assert.equal(isGeneratedAcceptanceImportHeader([generated[0] + "!", ...generated.slice(1)], product), false);
      assert.equal(isGeneratedAcceptanceImportHeader([generated[0].toLowerCase(), ...generated.slice(1)], product), false);
      assert.equal(isGeneratedAcceptanceImportHeader(generated.map(() => ""), product), false);
    }
  }
});

test("RU header bytes and column placement retain both existing protocols", () => {
  assert.equal(acceptanceImportHeaders(true, translation("ru")).join(";"), "Дата поставки;Наименование продукции;Годен до;Производитель/поставщик;ТТН, документы соответствия;Объем, номер партии, дата пр-ва;Внутр. темп-ра продукта;Соответствие товара сопроводительной документации;Принять/Отклонить (П/О);Корректирующие действия;Ответственный");
  assert.equal(acceptanceImportHeaders(false, translation("ru")).join(";"), "Дата поступления;Время поступления;Наименование;Производитель;Поставщик;Условия транспортировки;Соответствие упаковки;Результаты орг. оценки;Предельный срок реализации, дата;Предельный срок реализации, время;Примечания");
  for (const locale of ["ru", "en", "uz"]) {
    const t = translation(locale);
    const base = acceptanceProductColumns(false, t);
    const extended = acceptanceProductColumns(true, t);
    assert.equal(base.length, 11); assert.equal(extended.length, 12);
    assert.deepEqual(extended.slice(0, 8), base.slice(0, 8));
    assert.equal(extended[8], t("foodControlPdf.incomingControl.columns.packagingCompliance"));
    assert.deepEqual(extended.slice(9), base.slice(8));
  }
});

test("known field/enum pairs localize; unknown and custom-identical text stays raw", () => {
  const t = translation("en");
  assert.equal(acceptanceEnumLabel("transport", "unsatisfactory", t), "Unsatisfactory");
  assert.equal(acceptanceEnumLabel("packaging", "non_compliant", t), "Non-compliant");
  assert.equal(acceptanceEnumLabel("decision", "accept", t), t("foodControlPdf.incomingControl.decision.accept"));
  for (const raw of ["custom", "Соответствует", "Не удовл.", "compliant ", "constructor", "toString", ""]) {
    assert.equal(acceptanceEnumLabel("transport", raw, t), raw);
    assert.equal(acceptanceEnumLabel("decision", raw, t), raw);
  }
  assert.equal(acceptanceEnumLabel("packaging", "satisfactory", t), "satisfactory");
});

function normalizeWithProvenance(raw: unknown) {
  const captured = captureAcceptanceSummarySource(raw);
  const config = normalizeAcceptanceDocumentConfig(raw);
  const sidecar = bindAcceptanceSummarySource(captured, config);
  return { config, sidecar, bindings: bindAcceptanceSummaryRows(config, sidecar) };
}

test("only missing-own generated summaries receive a separate exact-row display binding", () => {
  const raw = { rows: [null, { id: "generated", transportCondition: "unsatisfactory", packagingCompliance: "no", decision: "reject" },
    { id: "explicit", transportCondition: "unsatisfactory", documentCompliance: "Соответствует" }] };
  const before = JSON.stringify(raw);
  const { config, sidecar, bindings } = normalizeWithProvenance(raw);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(sidecar.length, 1); assert.equal(sidecar[0].id, "generated");
  const [generated, explicit] = config.rows;
  const rawConfig = JSON.stringify(config);
  const draft = acceptanceRowToBatchDraft(generated);
  for (const locale of ["ru", "en", "uz"]) {
    const shown = acceptanceSummaryDisplay(generated, bindings, translation(locale));
    assert.ok(shown.length > 0);
    if (locale === "ru") assert.equal(shown, generated.documentCompliance);
    else assert.notEqual(shown, generated.documentCompliance);
    assert.equal(acceptanceSummaryDisplay(explicit, bindings, translation(locale)), "Соответствует");
  }
  assert.equal(JSON.stringify(config), rawConfig);
  assert.deepEqual(acceptanceRowToBatchDraft(generated), draft);
  assert.equal(acceptanceSummaryDisplay({ ...generated }, bindings, translation("en")), generated.documentCompliance);
  assert.equal(JSON.stringify(config).includes('"generatedSummaries"'), false);
  const badBinding = bindAcceptanceSummaryRows(config, [...sidecar, ...sidecar]);
  assert.equal(acceptanceSummaryDisplay(generated, badBinding, translation("en")), generated.documentCompliance);
  const customIdentical = normalizeWithProvenance({ rows: [{ ...generated, documentCompliance: generated.documentCompliance }] });
  assert.equal(customIdentical.sidecar.length, 0);
  assert.equal(acceptanceSummaryDisplay(customIdentical.config.rows[0], customIdentical.bindings, translation("en")), generated.documentCompliance);
});

test("explicit missing-like values, inherited/accessor/uncertain source, sparse arrays are not provenance", () => {
  for (const documentCompliance of [undefined, null, "", "Соответствует"]) {
    assert.equal(captureAcceptanceSummarySource({ rows: [{ id: "explicit", transportCondition: "satisfactory", documentCompliance }] }).length, 0);
  }
  let reads = 0;
  const accessor = { id: "getter", transportCondition: "satisfactory", get documentCompliance() { reads++; return "custom"; } };
  assert.equal(captureAcceptanceSummarySource({ rows: [accessor] }).length, 0);
  assert.equal(reads, 0);
  const configGetter = { get rows() { reads++; return []; } };
  assert.deepEqual(captureAcceptanceSummarySource(configGetter), []); assert.equal(reads, 0);
  const inherited = Object.assign(Object.create({ documentCompliance: "custom" }), { transportCondition: "satisfactory" });
  assert.deepEqual(captureAcceptanceSummarySource({ rows: [inherited] }), []);
  for (const transportCondition of ["custom", {}, () => "satisfactory", Symbol("custom")]) {
    assert.deepEqual(captureAcceptanceSummarySource({ rows: [{ transportCondition }] }), []);
  }
  const sparse = new Array(2); sparse[1] = { transportCondition: "satisfactory" };
  assert.deepEqual(captureAcceptanceSummarySource({ rows: sparse }), []);
});

test("owned Error metadata preserves raw identity/message and localizes only authored diagnostics", () => {
  const error = new Error("Не удалось сохранить документ");
  assert.equal(tagAcceptanceError(error, [{ key: "journalAcceptance.errors.saveDocument" }]), error);
  assert.equal(error.message, "Не удалось сохранить документ");
  const diagnostic = captureAcceptanceDiagnostic(error, "Ошибка", "journalControls.quickAdd.genericError");
  assert.equal(diagnostic.raw, error.message);
  assert.equal(formatAcceptanceDiagnostic(diagnostic, translation("en")), "Could not save document");
  const unknown = new Error(error.message);
  assert.equal(formatAcceptanceDiagnostic(captureAcceptanceDiagnostic(unknown, "Ошибка", "journalControls.quickAdd.genericError"), translation("en")), unknown.message);
  const combined = tagAcceptanceError(new Error("first\nsecond"), [
    { key: "journalAcceptance.errors.productName", values: { rowNumber: 3 } },
    { key: "journalAcceptance.errors.supplier", values: { rowNumber: 5 } },
  ]);
  assert.equal(formatAcceptanceDiagnostic(captureAcceptanceDiagnostic(combined, "Ошибка", "journalControls.quickAdd.genericError"), translation("en")), "Row 3: enter a product name\nRow 5: enter a supplier");
  assert.equal(combined.message, "first\nsecond");
});

test("the original raw reader's truthy/getter/throw order remains exact", () => {
  for (const value of [null, undefined, false, 0, {}, "", "   ", "custom", new Error("custom"), new Error("Failed to fetch")]) {
    const baseline = humanizeFetchError(value, "fallback");
    assert.equal(captureAcceptanceDiagnostic(value, "fallback", "journalControls.quickAdd.genericError").raw, baseline);
  }
  for (const message of ["custom", "Failed to fetch", "", "  "]) {
    const run = (candidate: boolean) => {
      const order: string[] = [];
      const error = new Error();
      Object.defineProperty(error, "message", { get() { order.push("message"); return message; } });
      const raw = candidate ? captureAcceptanceDiagnostic(error, "fallback", "journalControls.quickAdd.genericError").raw : humanizeFetchError(error, "fallback");
      return { raw, order };
    };
    assert.deepEqual(run(true), run(false));
  }
  const failure = new Error("getter sentinel");
  const error = new Error(); Object.defineProperty(error, "message", { get() { throw failure; } });
  assert.throws(() => captureAcceptanceDiagnostic(error, "fallback", "journalControls.quickAdd.genericError"), (actual) => actual === failure);
  const coercion = { toString() { throw new Error("must not coerce"); } };
  assert.equal(captureAcceptanceDiagnostic(coercion, "fallback", "journalControls.quickAdd.genericError").raw, "fallback");
});

test("whole ICU counts keep signed arithmetic and ungrouped inner values in each locale", () => {
  for (const locale of ["ru", "en", "uz"]) {
    const t = translation(locale);
    for (const count of [-3, 0, 1, 2, 5, 11, 21, 1000]) {
      for (const key of ["journalAcceptance.confirm.deleteCount", "journalAcceptance.confirm.remainingCount", "journalAcceptance.confirm.closeCount", "journalAcceptance.feedback.rowsDeleted"] as const) {
        assert.ok(t(key, { count }).endsWith(String(count)));
        assert.equal(t(key, { count }).includes("#"), false);
      }
    }
  }
});

test("calendar presentation has all months/weekdays and preserves ungrouped years", () => {
  for (const locale of ["ru", "en", "uz"]) {
    const t = translation(locale);
    const copy = acceptanceCalendarCopy(t);
    assert.equal(copy.months.length, 12);
    assert.equal(copy.weekdays.length, 7);
    for (let index = 0; index < 12; index += 1) {
      assert.equal(copy.months[index], t(`journalAcceptance.calendar.month${index + 1}` as AcceptanceMessageKey));
      assert.ok(copy.heading(copy.months[index], 2026).includes("2026"));
      assert.ok(copy.heading(copy.months[index], 10000).includes("10000"));
    }
  }
});

test("truthy API errors and custom-identical fallback prose remain original", () => {
  const fallback = "Не удалось создать документ";
  const sent = [undefined, null, false, 0, "", " ", 7, true, fallback, ["custom"], { arbitrary: true }];
  for (const rawError of sent) {
    const message = (rawError || fallback) as unknown as string;
    const original = new Error(message);
    const error = new Error(message);
    if (!rawError) tagAcceptanceError(error, [{ key: "journalAcceptance.list.createError" }]);
    const diagnostic = captureAcceptanceDiagnostic(error, fallback, "journalAcceptance.list.createError");
    assert.equal(error.message, original.message);
    assert.equal(diagnostic.raw, humanizeFetchError(original, fallback));
    for (const locale of ["en", "uz"]) {
      assert.equal(formatAcceptanceDiagnostic(diagnostic, translation(locale)), rawError && original.message.trim() ? original.message : translation(locale)("journalAcceptance.list.createError"));
    }
  }
});

test("organization fallback provenance preserves custom-identical names and building suffixes", () => {
  assert.equal(captureAcceptanceOrganizationFallbackSuffix("Организация", null, {}), "");
  assert.equal(captureAcceptanceOrganizationFallbackSuffix("Организация · Точка 2", { name: "Организация test@example.com" }, {}), " · Точка 2");
  for (const organization of [
    { name: "Организация" },
    { name: "Организация", journalShortName: "Организация" },
    { name: "", legalProfileJson: { nameShort: "Организация" } },
  ]) assert.equal(captureAcceptanceOrganizationFallbackSuffix("Организация", organization, {}), null);
  assert.equal(captureAcceptanceOrganizationFallbackSuffix("Организация", null, { headerOrgName: "Организация" }), null);
  assert.equal(captureAcceptanceOrganizationFallbackSuffix("other unexpected name", null, {}), null);
});
