/**
 * e2e-БД (НЕ прод): 1С:ЗУП по точкам и выгрузка журнала по точке.
 * 1С не вызывается — сотрудники передаются как от обработки 1С (API-путь).
 *
 * DATABASE_URL=…/wesetup_e2e node --import tsx .agent/tasks/point-hr-reports-2026-10-31/raw/check.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

import { db } from "@/lib/db";
import { runHrSync } from "@/lib/hr1c/sync.server";
import type { HrEmployee } from "@/lib/hr1c/plan";
import { loadReportTable } from "@/lib/report-export-data";

const DIR = ".agent/tasks/point-hr-reports-2026-10-31/raw";
const MARK = "ПРОВЕРКА 1С 31.10";
const out: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  out.push(line);
  console.log(line);
};

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_e2e")) throw new Error("e2e only");
  const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
  const orgId: string = seed.orgId;
  await db.organization.update({ where: { id: orgId }, data: { perLocationJournals: true } });
  const buildings = await db.building.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
  const A = buildings.find((b) => b.name === "Точка А")!;
  const B = buildings.find((b) => b.name === "Точка Б")!;

  // ---------- 1С ----------
  await db.hrEmployeeLink.deleteMany({ where: { organizationId: orgId, externalId: { startsWith: "chk-" } } });
  await db.user.deleteMany({ where: { organizationId: orgId, name: { startsWith: MARK } } });
  const position =
    (await db.jobPosition.findFirst({ where: { organizationId: orgId, name: `${MARK} Повар` }, select: { id: true } })) ??
    (await db.jobPosition.create({ data: { organizationId: orgId, name: `${MARK} Повар`, categoryKey: "staff" }, select: { id: true } }));
  await db.hrConnection.upsert({
    where: { organizationId: orgId },
    create: { organizationId: orgId, defaultPositionId: position.id, departmentPointsJson: { "dep-a": A.id, "dep-office": "*" } },
    update: { defaultPositionId: position.id, departmentPointsJson: { "dep-a": A.id, "dep-office": "*" }, departmentsJson: [] },
  });
  // Связанные раньше: «старый» из 1С без точек и тот, кому руководитель поставил точку Б.
  const mk = (name: string, buildingIds: string[]) =>
    db.user.create({ data: { organizationId: orgId, name: `${MARK} ${name}`, email: `chk-1c-${name}@verify.local`, role: "cook", passwordHash: "", buildingIds, jobPositionId: position.id }, select: { id: true } });
  const old = await mk("Старый", []);
  const manual = await mk("Ручной", [B.id]);
  await db.hrEmployeeLink.createMany({
    data: [
      { organizationId: orgId, externalId: "chk-old", userId: old.id, fullName: `${MARK} Старый` },
      { organizationId: orgId, externalId: "chk-manual", userId: manual.id, fullName: `${MARK} Ручной` },
    ],
  });
  const emp = (id: string, name: string, departmentId: string, departmentName: string): HrEmployee => ({
    externalId: id, fullName: `${MARK} ${name}`, position: null, hiredAt: "2026-10-01", dismissedAt: null, archived: false, phone: null, departmentId, departmentName,
  });
  const employees = [
    emp("chk-new-a", "Новая А", "dep-a", "Кухня точки А"),
    emp("chk-new-x", "Новый Склад", "dep-x", "Склад"),
    emp("chk-old", "Старый", "dep-a", "Кухня точки А"),
    emp("chk-manual", "Ручной", "dep-a", "Кухня точки А"),
  ];
  const preview = await runHrSync({ organizationId: orgId, employees, mode: "preview", defaultPositionId: position.id });
  check("1С «Проверить»: новая сотрудница получит точку А", preview.actions.some((a) => a.kind === "hire" && a.fullName.endsWith("Новая А") && (a.detail ?? "").includes("Точка А")), JSON.stringify(preview.actions.map((a) => [a.kind, a.fullName.replace(MARK, ""), a.detail])));
  check("1С «Проверить»: старому поставит точку А", preview.actions.some((a) => a.kind === "points" && a.fullName.endsWith("Старый")));
  check("1С «Проверить»: подразделение «Склад» без сопоставления — проблема", preview.problems.some((p) => p.reason === "no_point_mapping" && p.detail === "Склад"));
  const departments = (await db.hrConnection.findUnique({ where: { organizationId: orgId }, select: { departmentsJson: true } }))?.departmentsJson as Array<{ key: string }>;
  check("1С: подразделения сохранены для экрана сопоставления", departments.map((d) => d.key).sort().join(",") === "dep-a,dep-x");

  const applied = await runHrSync({ organizationId: orgId, employees, mode: "apply", defaultPositionId: position.id });
  const points = async (externalId: string) => {
    const link = await db.hrEmployeeLink.findUnique({ where: { organizationId_externalId: { organizationId: orgId, externalId } }, select: { userId: true } });
    return link ? (await db.user.findUnique({ where: { id: link.userId }, select: { buildingIds: true } }))?.buildingIds ?? null : null;
  };
  check("1С «Применить»: ошибок нет", applied.errors.length === 0, applied.errors.join("; "));
  check("1С: новая сотрудница — точка А", JSON.stringify(await points("chk-new-a")) === JSON.stringify([A.id]));
  check("1С: новый из несопоставленного подразделения — без точек", JSON.stringify(await points("chk-new-x")) === "[]");
  check("1С: старый из 1С без точек — точка А", JSON.stringify(await points("chk-old")) === JSON.stringify([A.id]));
  check("1С: точка, поставленная руководителем, не тронута", JSON.stringify(await points("chk-manual")) === JSON.stringify([B.id]));

  // Сотрудник перешёл в подразделение «Офис» (все точки) — 1С меняет свои точки; руками поменянные — нет.
  const newA = await db.hrEmployeeLink.findUnique({ where: { organizationId_externalId: { organizationId: orgId, externalId: "chk-new-a" } }, select: { userId: true } });
  await db.user.update({ where: { id: newA!.userId }, data: { buildingIds: [B.id] } }); // руководитель перевёл на Б
  const moved = [emp("chk-old", "Старый", "dep-office", "Офис"), emp("chk-new-a", "Новая А", "dep-office", "Офис")];
  await runHrSync({ organizationId: orgId, employees: moved, mode: "apply", defaultPositionId: position.id });
  check("1С: перевод в «Офис» — у старого все точки", JSON.stringify(await points("chk-old")) === "[]");
  check("1С: у переведённой руководителем на Б точка не тронута", JSON.stringify(await points("chk-new-a")) === JSON.stringify([B.id]));

  // ---------- Выгрузка журнала ----------
  const template = await db.journalTemplate.findFirstOrThrow({ where: { code: "cold_equipment_control" }, select: { id: true } });
  await db.journalDocument.deleteMany({ where: { organizationId: orgId, title: { startsWith: "Проверка выгрузки 31.10" } } });
  const from = new Date("2026-10-20T00:00:00.000Z");
  const to = new Date("2026-10-31T00:00:00.000Z");
  const author = (await db.user.findFirstOrThrow({ where: { email: seed.manager }, select: { id: true } })).id;
  for (const [point, temperature] of [[A, 3], [B, 7]] as const) {
    const doc = await db.journalDocument.create({
      data: { organizationId: orgId, templateId: template.id, buildingId: point.id, title: `Проверка выгрузки 31.10 · ${point.name}`, status: "closed", dateFrom: from, dateTo: to },
      select: { id: true },
    });
    await db.journalDocumentEntry.create({ data: { documentId: doc.id, employeeId: author, date: new Date("2026-10-25T00:00:00.000Z"), data: { checkMarker: `маркер-${point.name}`, temperature } as never } });
  }
  const atA = await loadReportTable({ templateCode: "cold_equipment_control", organizationId: orgId, dateFrom: "2026-10-25", dateTo: "2026-10-25", pointId: A.id });
  const textA = JSON.stringify(atA?.table.rows ?? []);
  check("выгрузка точки А: её запись есть", textA.includes("маркер-Точка А"));
  check("выгрузка точки А: записи точки Б нет", !textA.includes("маркер-Точка Б"));
  check("выгрузка точки А: без колонки «Точка»", !(atA?.table.headers ?? []).includes("Точка"));
  const all = await loadReportTable({ templateCode: "cold_equipment_control", organizationId: orgId, dateFrom: "2026-10-25", dateTo: "2026-10-25", pointId: null });
  const headers = all?.table.headers ?? [];
  const pointCol = headers.indexOf("Точка");
  const rowB = (all?.table.rows ?? []).find((row) => row.join("|").includes("маркер-Точка Б"));
  check("выгрузка всей организации: колонка «Точка», у строки точки Б — «Точка Б»", pointCol === 1 && rowB?.[pointCol] === "Точка Б", JSON.stringify(headers));

  writeFileSync(`${DIR}/check.txt`, out.join("\n") + "\n");
  const failed = out.filter((line) => line.startsWith("FAIL")).length;
  console.log(failed === 0 ? `ALL PASS (${out.length})` : `FAILED ${failed}/${out.length}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().finally(() => db.$disconnect());
