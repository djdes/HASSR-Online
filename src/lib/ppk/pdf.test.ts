import test from "node:test";
import assert from "node:assert/strict";

import { buildHaccpPlanPdf, buildPpkProgramPdf } from "./pdf";
import type { PpkBundle } from "./assemble.server";

const emptyBundle = (): PpkBundle => ({
  org: { logoUrl: null, orgName: "ООО «Тест»", orgInn: null, orgAddress: null, snapshot: null },
  team: [],
  policy: null,
  products: [],
  flowcharts: [],
  hazards: [],
  points: [],
  norms: [],
  lab: [],
  pest: [],
  journals: [],
  staffCount: 0,
  positions: [],
  responsibles: [],
  roster: [],
  approvals: { ppk: null, "haccp-plan": null },
});

const smallBundle = (): PpkBundle => ({
  ...emptyBundle(),
  org: { logoUrl: null, orgName: "ООО «Тест»", orgInn: "7700000000", orgAddress: "Москва", snapshot: null },
  team: [{ userId: "u1", role: "leader", duties: "Руководит", name: "Иванов Иван", title: "Шеф-повар" }],
  norms: ["СанПиН 2.3/2.4.3590-20"],
  positions: ["Повар"],
  roster: [{ name: "Иванов Иван", title: "Шеф-повар" }],
  approvals: {
    ppk: { version: 2, approvedAt: "2026-10-01", approver: { name: "Петров Пётр", title: "Директор" } },
    "haccp-plan": null,
  },
  flowcharts: [
    {
      id: "f1",
      title: "Горячий цех",
      nodes: [
        { id: "a", x: 0, y: 0, w: 240, h: 56, label: "Приёмка сырья и тары с длинной подписью", kind: "step", ccp: "ККТ-1", areaId: null },
        { id: "b", x: 0, y: 160, w: 240, h: 56, label: "Тепловая обработка", kind: "step", ccp: null, areaId: null },
      ],
      edges: [{ id: "e", from: "a", to: "b", points: [], flow: "raw", label: "сырьё" }],
    },
  ],
} as unknown as Partial<PpkBundle> as PpkBundle);

for (const [name, build] of [
  ["программа", buildPpkProgramPdf],
  ["план ХАССП", buildHaccpPlanPdf],
] as const) {
  test(`${name}: пустой набор данных даёт PDF`, () => {
    const pdf = build(emptyBundle());
    assert.equal(pdf.subarray(0, 4).toString("latin1"), "%PDF");
  });
  test(`${name}: маленький набор данных даёт PDF`, () => {
    const pdf = build(smallBundle());
    assert.equal(pdf.subarray(0, 4).toString("latin1"), "%PDF");
  });
}
