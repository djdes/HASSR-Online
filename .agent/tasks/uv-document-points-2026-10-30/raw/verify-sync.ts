/**
 * Проверка на e2e-БД (НЕ прод): документы УФ-ламп переезжают на точку цеха
 * лампы, общий цех остаётся общим, закрытая история на живой точке не
 * трогается, QR лампы ставит точку найденному документу.
 *
 * DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wesetup_e2e?sslmode=disable \
 *   node --import tsx .agent/tasks/uv-document-points-2026-10-30/raw/verify-sync.ts
 */
import assert from "node:assert/strict";

import { buildingWhere } from "@/lib/building-scope";
import { db } from "@/lib/db";
import { ensureUvDocumentForLamp } from "@/lib/uv-lamp-runs";
import { syncUvDocumentPoints } from "@/lib/uv-document-points";
import { UV_LAMP_RUNTIME_TEMPLATE_CODE } from "@/lib/uv-lamp-runtime-document";

if (!/localhost:5432\/wesetup_e2e/.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Только e2e-БД: DATABASE_URL должен указывать на localhost:5432/wesetup_e2e");
}

async function main() {
  const template = await db.journalTemplate.findFirst({ where: { code: UV_LAMP_RUNTIME_TEMPLATE_CODE }, select: { id: true } });
  assert.ok(template, "в e2e-БД нет шаблона uv_lamp_runtime");
  const org = await db.organization.create({ data: { name: "UV points check 2026-10-30", type: "restaurant", perLocationJournals: true } });
  const results: Array<{ check: string; ok: boolean; detail?: unknown }> = [];
  try {
    const gym4 = await db.building.create({ data: { organizationId: org.id, name: "4 гимназия" } });
    const odin = await db.building.create({ data: { organizationId: org.id, name: "Одинцовская гимназия" } });
    const areaGym = await db.area.create({ data: { organizationId: org.id, name: "Пищеблок 4 гимназии", buildingId: gym4.id } });
    const areaShared = await db.area.create({ data: { organizationId: org.id, name: "Общий цех" } });
    const l1 = await db.equipment.create({ data: { areaId: areaGym.id, name: "Рециркулятор \"Гелиос\" №1", type: "uv_lamp" } });
    const l2 = await db.equipment.create({ data: { areaId: areaGym.id, name: "Рециркулятор \"Гелиос\" №2", type: "uv_lamp" } });
    const ls = await db.equipment.create({ data: { areaId: areaShared.id, name: "УФ-лампа общего цеха", type: "uv_lamp" } });

    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    const prevFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const prevTo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    const mk = (title: string, buildingId: string | null, config: Record<string, unknown>, status = "active", period: [Date, Date] = [from, to]) =>
      db.journalDocument.create({
        data: { organizationId: org.id, templateId: template.id, title, buildingId, status, dateFrom: period[0], dateTo: period[1], config: config as never },
        select: { id: true },
      });
    const d1 = await mk("d1", null, { lampNumber: l1.name, equipmentId: l1.id });
    const d2 = await mk("d2", null, { lampNumber: l2.name, equipmentId: l2.id }, "closed", [prevFrom, prevTo]);
    const d3 = await mk("d3", odin.id, { lampNumber: l1.name, equipmentId: l1.id }, "closed", [prevFrom, prevTo]);
    const d4 = await mk("d4", null, { lampNumber: ls.name, equipmentId: ls.id });
    const d5 = await mk("d5", null, { lampNumber: ` ${l2.name.toLowerCase()} ` });
    const d6 = await mk("d6", odin.id, { lampNumber: "1" });

    const visibleAt = async (buildingId: string, status: string) =>
      (
        await db.journalDocument.findMany({
          where: { organizationId: org.id, templateId: template.id, status, ...buildingWhere(buildingId) },
          select: { title: true },
          orderBy: { title: "asc" },
        })
      ).map((doc) => doc.title);

    const before = await visibleAt(odin.id, "active");
    results.push({ check: "до исправления: на Одинцовской видны лампы 4 гимназии", ok: before.includes("d1") && before.includes("d5"), detail: before });

    const moved = await syncUvDocumentPoints(org.id);
    results.push({ check: "перенесено 3 документа (d1, d2, d5)", ok: moved === 3, detail: moved });

    const point = async (id: string) => (await db.journalDocument.findUniqueOrThrow({ where: { id }, select: { buildingId: true } })).buildingId;
    results.push({ check: "d1 активный без точки → 4 гимназия", ok: (await point(d1.id)) === gym4.id });
    results.push({ check: "d2 закрытый без точки → 4 гимназия", ok: (await point(d2.id)) === gym4.id });
    results.push({ check: "d3 закрытый на живой точке — история, не тронут", ok: (await point(d3.id)) === odin.id });
    results.push({ check: "d4 лампа общего цеха — остаётся общим", ok: (await point(d4.id)) === null });
    results.push({ check: "d5 без связи, номер = название лампы → 4 гимназия", ok: (await point(d5.id)) === gym4.id });
    results.push({ check: "d6 свой документ Одинцовской («№1») — не тронут", ok: (await point(d6.id)) === odin.id });

    const odinActive = await visibleAt(odin.id, "active");
    const gymActive = await visibleAt(gym4.id, "active");
    results.push({ check: "Одинцовская, активные: только свой №1 и общий", ok: JSON.stringify(odinActive) === JSON.stringify(["d4", "d6"]), detail: odinActive });
    results.push({ check: "4 гимназия, активные: её лампы и общий", ok: JSON.stringify(gymActive) === JSON.stringify(["d1", "d4", "d5"]), detail: gymActive });

    const again = await syncUvDocumentPoints(org.id);
    results.push({ check: "повторный запуск ничего не меняет", ok: again === 0, detail: again });

    // QR лампы: старый документ без точки получает точку лампы при «Я включил».
    await db.journalDocument.update({ where: { id: d1.id }, data: { buildingId: null } });
    const ensured = await ensureUvDocumentForLamp({
      organizationId: org.id,
      lamp: { id: l1.id, name: l1.name, areaName: areaGym.name, lampLifetimeHours: null },
      todayKey,
    });
    results.push({ check: "QR: найден тот же документ лампы", ok: ensured?.id === d1.id, detail: ensured?.id });
    results.push({ check: "QR: документ получил точку лампы", ok: (await point(d1.id)) === gym4.id });

    // Лампу перенесли в цех другой точки — активный документ следом, закрытая история — нет.
    const areaOdin = await db.area.create({ data: { organizationId: org.id, name: "Пищеблок Одинцовской", buildingId: odin.id } });
    await db.equipment.update({ where: { id: l1.id }, data: { areaId: areaOdin.id } });
    await syncUvDocumentPoints(org.id);
    results.push({ check: "лампа перенесена: активный d1 → Одинцовская", ok: (await point(d1.id)) === odin.id });
    results.push({ check: "лампа перенесена: закрытый d3 остаётся (история)", ok: (await point(d3.id)) === odin.id });
  } finally {
    await db.journalDocument.deleteMany({ where: { organizationId: org.id } });
    await db.equipment.deleteMany({ where: { area: { organizationId: org.id } } });
    await db.area.deleteMany({ where: { organizationId: org.id } });
    await db.building.deleteMany({ where: { organizationId: org.id } });
    await db.organization.delete({ where: { id: org.id } });
  }
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.check}${r.detail !== undefined ? `  ${JSON.stringify(r.detail)}` : ""}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed === 0 ? `ALL PASS (${results.length})` : `FAILED ${failed}/${results.length}`);
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
