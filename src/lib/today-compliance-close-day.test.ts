import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * «Закрыть день» по точкам (2026-09-23): закрытие дня на точке A не должно
 * зеленить журнал точке B. Раньше `getTemplatesFilledToday` брал все
 * закрытия организации за сегодня без фильтра по точке, и счётчик во
 * вкладке точки B рос от закрытия на A.
 *
 * Вместо базы — подменная Prisma в `globalThis.prisma` (её берёт
 * `src/lib/db.ts`, если она уже есть). Тестовые процессы node:test
 * изолированы по файлам, поэтому подмена не протекает в другие тесты.
 */

type CloseEventRow = {
  organizationId: string;
  templateId: string;
  date: Date;
  buildingKey: string;
  reopenedAt: Date | null;
};

const ORG = "org-close-day";
const TODAY = new Date("2026-09-23T00:00:00.000Z");

const closeEvents: CloseEventRow[] = [
  // Точка A закрыла день по журналу t-a.
  { organizationId: ORG, templateId: "t-a", date: TODAY, buildingKey: "b-a", reopenedAt: null },
  // Общее закрытие организации (до режима точек) — действует для всех.
  { organizationId: ORG, templateId: "t-all", date: TODAY, buildingKey: "", reopenedAt: null },
  // Точка B закрыла t-b, но потом переоткрыла — не считается.
  {
    organizationId: ORG,
    templateId: "t-b",
    date: TODAY,
    buildingKey: "b-b",
    reopenedAt: new Date("2026-09-23T10:00:00.000Z"),
  },
];

function matchesCloseEvent(row: CloseEventRow, where: Record<string, unknown>): boolean {
  if (where.organizationId !== undefined && row.organizationId !== where.organizationId) return false;
  if (where.date instanceof Date && row.date.getTime() !== where.date.getTime()) return false;
  if (where.reopenedAt === null && row.reopenedAt !== null) return false;
  const buildingKey = where.buildingKey as { in?: string[] } | string | undefined;
  if (typeof buildingKey === "string" && row.buildingKey !== buildingKey) return false;
  if (buildingKey && typeof buildingKey === "object" && buildingKey.in) {
    if (!buildingKey.in.includes(row.buildingKey)) return false;
  }
  return true;
}

function emptyModel() {
  return new Proxy(
    {},
    {
      get: (_target, method: string) => async () => {
        if (method === "count") return 0;
        if (method === "findUnique" || method === "findFirst") return null;
        return [];
      },
    },
  );
}

const fakePrisma = new Proxy(
  {},
  {
    get: (_target, model: string) => {
      if (model === "organization") {
        return { findUnique: async () => ({ timezone: "UTC" }) };
      }
      if (model === "journalDocument") {
        // По активному ежедневному документу на журнал, без записей за
        // сегодня: сами по себе журналы не заполнены, зеленит их только
        // закрытие дня.
        return {
          findMany: async () =>
            ["t-a", "t-b", "t-all"].map((templateId) => ({
              id: `doc-${templateId}`,
              templateId,
              config: {},
              template: { code: "climate_control" },
            })),
        };
      }
      if (model === "journalCloseEvent") {
        return {
          findMany: async ({ where }: { where: Record<string, unknown> }) =>
            closeEvents.filter((row) => matchesCloseEvent(row, where)),
        };
      }
      return emptyModel();
    },
  },
);

(globalThis as unknown as { prisma: unknown }).prisma = fakePrisma;

const NOW = new Date("2026-09-23T12:00:00.000Z");

test("закрытие дня на точке A не засчитывается точке B", async () => {
  const { getTemplatesFilledToday } = await import("./today-compliance");
  const pointA = await getTemplatesFilledToday(ORG, NOW, undefined, undefined, {
    buildingId: "b-a",
  });
  const pointB = await getTemplatesFilledToday(ORG, NOW, undefined, undefined, {
    buildingId: "b-b",
  });
  assert.equal(pointA.has("t-a"), true, "своё закрытие точки A засчитано");
  assert.equal(pointB.has("t-a"), false, "закрытие точки A не зеленит точку B");
  assert.equal(pointB.has("t-b"), false, "переоткрытый день не считается закрытым");
});

test("общее закрытие организации действует для каждой точки", async () => {
  const { getTemplatesFilledToday } = await import("./today-compliance");
  for (const buildingId of ["b-a", "b-b"]) {
    const filled = await getTemplatesFilledToday(ORG, NOW, undefined, undefined, { buildingId });
    assert.equal(filled.has("t-all"), true, `общее закрытие видно точке ${buildingId}`);
  }
});

test("без точки поведение прежнее: любые активные закрытия организации", async () => {
  const { getTemplatesFilledToday } = await import("./today-compliance");
  const filled = await getTemplatesFilledToday(ORG, NOW);
  assert.deepEqual([...filled].sort(), ["t-a", "t-all"]);
});
