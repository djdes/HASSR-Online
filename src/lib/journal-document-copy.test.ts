import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DOCUMENT_COPY_SUPPORTED_CODES,
  buildDocumentCopy,
  copyDocumentStructure,
  resolveDocumentCopyPeriod,
} from "@/lib/journal-document-copy";

const TODAY = "2026-09-19";

const copy = (
  templateCode: string,
  sourceConfig: unknown,
  sourcePeriod = { dateFrom: "2026-01-01", dateTo: "2026-12-31" },
  existingTitles: string[] = []
) =>
  buildDocumentCopy({
    templateCode,
    journalName: "Журнал",
    sourceConfig,
    sourcePeriod,
    today: TODAY,
    existingTitles,
  });

describe("resolveDocumentCopyPeriod", () => {
  it("годовой журнал — следующий год", () => {
    assert.deepEqual(
      resolveDocumentCopyPeriod(
        "equipment_maintenance",
        { dateFrom: "2026-01-01", dateTo: "2026-12-31" },
        TODAY
      ),
      { dateFrom: "2027-01-01", dateTo: "2027-12-31" }
    );
  });

  it("копия старого документа не уезжает в прошлое", () => {
    // Источник за 2019 год: «следующий» — 2020-й, он давно прошёл.
    // Берём текущий период, иначе копия рождалась бы задним числом.
    assert.deepEqual(
      resolveDocumentCopyPeriod(
        "equipment_maintenance",
        { dateFrom: "2019-01-01", dateTo: "2019-12-31" },
        TODAY
      ),
      { dateFrom: "2026-01-01", dateTo: "2026-12-31" }
    );
  });

  it("однодневный источник годового журнала разворачивается в год", () => {
    // В базе у старых документов лежит «дата документа» (один день).
    // Считать «следующий период» от одного дня нельзя.
    assert.deepEqual(
      resolveDocumentCopyPeriod(
        "audit_plan",
        { dateFrom: "2026-03-05", dateTo: "2026-03-05" },
        TODAY
      ),
      { dateFrom: "2027-01-01", dateTo: "2027-12-31" }
    );
  });

  it("бессрочный журнал — период с сегодня", () => {
    const got = resolveDocumentCopyPeriod(
      "sanitary_day_control",
      { dateFrom: "2024-05-05", dateTo: "2099-12-31" },
      TODAY
    );
    assert.equal(got.dateFrom, TODAY);
    assert.equal(got.dateTo, "2099-12-31");
  });

  it("битый период источника — текущий период журнала", () => {
    assert.deepEqual(
      resolveDocumentCopyPeriod("audit_plan", { dateFrom: "", dateTo: "" }, TODAY),
      { dateFrom: "2026-01-01", dateTo: "2026-12-31" }
    );
  });
});

describe("buildDocumentCopy — название и общие поля", () => {
  it("название собирается на новый период", () => {
    assert.equal(copy("equipment_maintenance", {}).title, "Журнал — 2027 год");
  });

  it("занятое название получает суффикс", () => {
    assert.equal(
      copy("equipment_maintenance", {}, undefined, ["Журнал — 2027 год"]).title,
      "Журнал — 2027 год (2)"
    );
  });

  it("год и дата документа в шапке — от нового периода", () => {
    const got = copy("equipment_maintenance", {
      year: 2026,
      documentDate: "2026-01-01",
    });
    assert.equal(got.config.year, 2027);
    assert.equal(got.config.documentDate, "2027-01-01");
  });

  it("дата закрытия и ссылки на источник не переезжают", () => {
    const got = copy("audit_protocol", {
      closedAt: "2026-09-01",
      finishedAt: "2026-09-01",
      sourcePlanDocumentId: "plan-1",
      sourcePlanTitle: "План",
    });
    assert.equal("closedAt" in got.config, false);
    assert.equal("finishedAt" in got.config, false);
    assert.equal("sourcePlanDocumentId" in got.config, false);
    assert.equal("sourcePlanTitle" in got.config, false);
  });
});

describe("buildDocumentCopy — план внутреннего аудита", () => {
  it("состав разделов и требований остаётся, галочки и значения — нет", () => {
    const got = copy("audit_plan", {
      columns: [{ id: "c1", title: "Январь", auditorName: "Иванова" }],
      sections: [{ id: "s1", title: "Склад" }],
      rows: [
        { id: "r1", sectionId: "s1", text: "Проверить склад", checked: true, values: { c1: "ок" } },
      ],
    });
    assert.deepEqual(got.config.columns, [
      { id: "c1", title: "Январь", auditorName: "Иванова" },
    ]);
    assert.deepEqual(got.config.rows, [
      { id: "r1", sectionId: "s1", text: "Проверить склад", checked: false, values: {} },
    ]);
  });
});

describe("buildDocumentCopy — протокол аудита", () => {
  it("требования остаются, результат, замечание и подписи обнуляются", () => {
    const got = copy("audit_protocol", {
      basisTitle: "Приказ №1",
      auditedObject: "Кухня",
      sections: [{ id: "s1", title: "Склад" }],
      rows: [
        { id: "r1", sectionId: "s1", text: "Есть журнал", result: "yes", note: "всё ок", planRowId: "p1" },
      ],
      signatures: [{ id: "g1", name: "Иванова", role: "Управляющий", signedAt: "2026-09-01" }],
    });
    assert.equal(got.config.basisTitle, "Приказ №1");
    assert.deepEqual(got.config.sections, [{ id: "s1", title: "Склад" }]);
    assert.deepEqual(got.config.rows, [
      { id: "r1", sectionId: "s1", text: "Есть журнал", result: "", note: "" },
    ]);
    assert.deepEqual(got.config.signatures, [
      { id: "g1", name: "", role: "Управляющий", signedAt: "" },
    ]);
  });
});

describe("buildDocumentCopy — поверка средств измерений", () => {
  it("перечень приборов остаётся, дата последней поверки обнуляется", () => {
    const got = copy("equipment_calibration", {
      approveRole: "Управляющий",
      approveEmployee: "Иванова",
      rows: [
        {
          id: "r1",
          equipmentName: "Термометр",
          equipmentNumber: "12",
          calibrationInterval: 12,
          lastCalibrationDate: "2026-02-01",
        },
      ],
    });
    assert.equal(got.config.approveEmployee, "Иванова");
    assert.deepEqual(got.config.rows, [
      {
        id: "r1",
        equipmentName: "Термометр",
        equipmentNumber: "12",
        calibrationInterval: 12,
        lastCalibrationDate: "",
      },
    ]);
  });
});

describe("buildDocumentCopy — ТО оборудования", () => {
  it("план по месяцам остаётся, факт обнуляется", () => {
    const got = copy("equipment_maintenance", {
      rows: [
        {
          id: "r1",
          equipmentName: "Печь",
          maintenanceType: "A",
          plan: { jan: "+", feb: "" },
          fact: { jan: "05.01", feb: "" },
        },
      ],
    });
    assert.deepEqual(got.config.rows, [
      {
        id: "r1",
        equipmentName: "Печь",
        maintenanceType: "A",
        plan: { jan: "+", feb: "" },
        fact: { jan: "", feb: "" },
      },
    ]);
  });
});

describe("buildDocumentCopy — график генеральных уборок", () => {
  it("состав помещений и план остаются, факт обнуляется", () => {
    const got = copy("general_cleaning", {
      responsibleRole: "Управляющий",
      rows: [
        {
          id: "r1",
          roomName: "Горячий цех",
          plan: { jan: "+", feb: "+" },
          fact: { jan: "12.01", feb: "" },
        },
      ],
    });
    assert.equal(got.config.responsibleRole, "Управляющий");
    assert.deepEqual(got.config.rows, [
      {
        id: "r1",
        roomName: "Горячий цех",
        plan: { jan: "+", feb: "+" },
        fact: { jan: "", feb: "" },
      },
    ]);
  });
});

describe("buildDocumentCopy — график генуборок, уборки по датам", () => {
  it("план переезжает на новый год, отметки и внеплановые остаются в старом", () => {
    const got = copy("general_cleaning", {
      year: 2026,
      rows: [
        {
          id: "r1",
          roomId: "R1",
          roomName: "Кухня",
          cleanings: [
            { id: "p:2026-09-04", planned: "2026-09-04", done: "2026-09-04", doneSource: "manual" },
            { id: "p:2026-09-11", planned: "2026-09-11", done: null },
            { id: "u:2026-09-20", planned: null, done: "2026-09-20", doneSource: "task" },
          ],
          legacyNotes: { oct: { plan: "по графику", fact: "✓" } },
        },
        // Строка старого формата — как раньше: план как есть, факт пустой.
        { id: "r2", roomName: "Склад", plan: { jan: "+" }, fact: { jan: "12.01" } },
      ],
    });
    assert.equal(got.config.year, 2027);
    const [row, legacy] = got.config.rows as Array<Record<string, unknown>>;
    assert.deepEqual(row.cleanings, [
      { id: "p:2027-09-04", planned: "2027-09-04", done: null },
      { id: "p:2027-09-11", planned: "2027-09-11", done: null },
    ]);
    assert.deepEqual(row.legacyNotes, { oct: { plan: "по графику" } });
    assert.equal((row.plan as Record<string, string>).sep, "04, 11");
    assert.equal((row.fact as Record<string, string>).sep, "-");
    assert.equal(row.roomId, "R1");
    assert.deepEqual(legacy, { id: "r2", roomName: "Склад", plan: { jan: "+" }, fact: { jan: "" } });
  });
});

describe("buildDocumentCopy — перечень стеклянных изделий", () => {
  it("опись целиком остаётся, название выравнивается по документу", () => {
    const got = copy(
      "glass_items_list",
      {
        documentName: "Перечень — 2026 год",
        documentDate: "2026-01-01",
        responsibleTitle: "Управляющий",
        rows: [
          { id: "r1", location: "Бар", itemName: "Бокал", quantity: "20" },
          { id: "r2", location: "Кухня", itemName: "Банка", quantity: "5" },
        ],
      }
    );
    assert.equal((got.config.rows as unknown[]).length, 2);
    assert.deepEqual(got.config.rows, [
      { id: "r1", location: "Бар", itemName: "Бокал", quantity: "20" },
      { id: "r2", location: "Кухня", itemName: "Банка", quantity: "5" },
    ]);
    assert.equal(got.config.documentName, got.title);
    assert.equal(got.config.responsibleTitle, "Управляющий");
  });
});

describe("buildDocumentCopy — чек-лист санитарного дня", () => {
  it("зоны, пункты и ответственные остаются", () => {
    const got = copy(
      "sanitary_day_control",
      {
        zones: [{ id: "z1", name: "Кухня" }],
        items: [{ id: "i1", zoneId: "z1", text: "Протереть столы" }],
        generalPrinciples: ["Сверху вниз"],
        responsibleName: "Иванова",
        checkerName: "Петрова",
      },
      { dateFrom: "2026-01-05", dateTo: "2099-12-31" }
    );
    assert.deepEqual(got.config.zones, [{ id: "z1", name: "Кухня" }]);
    assert.deepEqual(got.config.items, [
      { id: "i1", zoneId: "z1", text: "Протереть столы" },
    ]);
    assert.equal(got.config.responsibleName, "Иванова");
    assert.equal(got.dateFrom, TODAY);
  });
});

describe("copyDocumentStructure — структура без факта на новый период", () => {
  it("совпадает с конфигом копии (кроме названия)", () => {
    const source = {
      year: 2026,
      documentDate: "2026-01-01",
      closedAt: "2026-12-31",
      rows: [
        {
          id: "r1",
          equipmentName: "Печь",
          plan: { jan: "+" },
          fact: { jan: "05.01" },
        },
      ],
    };
    const structure = copyDocumentStructure(
      "equipment_maintenance",
      source,
      "2027-01-01"
    );
    assert.deepEqual(structure, copy("equipment_maintenance", source).config);
  });

  it("год и дата документа — от начала нового периода", () => {
    const got = copyDocumentStructure(
      "equipment_calibration",
      { year: 2025, documentDate: "2025-01-01", rows: [] },
      "2026-01-01"
    );
    assert.equal(got.year, 2026);
    assert.equal(got.documentDate, "2026-01-01");
  });

  it("исходный конфиг не меняется", () => {
    const source = {
      closedAt: "2026-09-01",
      rows: [{ id: "r1", checked: true, values: { c1: "ок" } }],
    };
    const before = JSON.stringify(source);
    copyDocumentStructure("audit_plan", source, "2027-01-01");
    assert.equal(JSON.stringify(source), before);
  });

  it("мусор на входе — пустой конфиг", () => {
    assert.deepEqual(
      copyDocumentStructure("glass_items_list", null, "2027-01-01"),
      {}
    );
    assert.deepEqual(copyDocumentStructure("audit_plan", "x", "2027-01-01"), {
      rows: [],
    });
  });

  it("перечень журналов с копией — те семь, что умеют «Сделать копию»", () => {
    assert.deepEqual([...DOCUMENT_COPY_SUPPORTED_CODES].sort(), [
      "audit_plan",
      "audit_protocol",
      "equipment_calibration",
      "equipment_maintenance",
      "general_cleaning",
      "glass_items_list",
      "sanitary_day_control",
    ]);
  });
});
