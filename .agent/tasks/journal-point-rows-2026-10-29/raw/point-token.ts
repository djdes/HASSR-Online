// QR «Все журналы» точки А в тестовой организации — только e2e-база.
import { writeFileSync, readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { journalFillSubject, JOURNAL_FILL_HUB_CODE } from "@/lib/journal-fill";
import { mintQrFillToken } from "@/lib/qr-fill-token";

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_e2e")) throw new Error("e2e only");
  const seed = JSON.parse(readFileSync(".agent/tasks/qr-point-roster-uv-2026-10/raw/seed.json", "utf8"));
  const org = await db.organization.findUnique({ where: { id: seed.orgId }, select: { perLocationJournals: true } });
  const buildings = await db.building.findMany({ where: { organizationId: seed.orgId }, select: { id: true, name: true, kind: true } });
  const pointA = buildings.find((b) => b.name === "Точка А");
  if (!pointA) throw new Error("no point A");
  const people = await db.user.findMany({
    where: { organizationId: seed.orgId, isActive: true, archivedAt: null, isRoot: false },
    select: { id: true, name: true, buildingIds: true },
    orderBy: { name: "asc" },
  });
  const token = mintQrFillToken("journal", journalFillSubject(seed.orgId, JOURNAL_FILL_HUB_CODE, null, { buildingId: pointA.id }));
  const out = {
    orgId: seed.orgId,
    perLocationJournals: org?.perLocationJournals ?? false,
    buildings,
    pointA: pointA.id,
    people: people.map((p) => ({ name: p.name, points: p.buildingIds.map((id) => buildings.find((b) => b.id === id)?.name ?? `?${id}`) })),
    hygieneUrl: `/journal-fill/${seed.orgId}/hygiene?token=${encodeURIComponent(token)}`,
  };
  writeFileSync(".agent/tasks/journal-point-rows-2026-10-29/raw/point-token.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, hygieneUrl: "(в файле)" }, null, 2));
}
main().finally(() => db.$disconnect());
