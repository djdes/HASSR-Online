/**
 * e2e-БД (НЕ прод): после http-check — приёмка легла в журнал точки А,
 * точка сохранилась в накладной.
 */
import { readFileSync, appendFileSync } from "node:fs";

import { db } from "@/lib/db";

const DIR = ".agent/tasks/point-supply-2026-10-31/raw";

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_e2e")) throw new Error("e2e only");
  const fx = JSON.parse(readFileSync(`${DIR}/fixture.json`, "utf8"));
  const accepted = JSON.parse(readFileSync(`${DIR}/accepted.json`, "utf8"));
  const doc = await db.supplyDocument.findUniqueOrThrow({ where: { id: fx.noPointDocId }, select: { status: true, buildingId: true, journalDocumentId: true } });
  const journal = accepted.journalDocumentId
    ? await db.journalDocument.findUnique({ where: { id: accepted.journalDocumentId }, select: { buildingId: true, template: { select: { code: true } } } })
    : null;
  const lines = [
    `${doc.status === "accepted" ? "PASS" : "FAIL"} накладная принята — ${doc.status}`,
    `${doc.buildingId === fx.pointA ? "PASS" : "FAIL"} точка накладной — точка А`,
    `${journal?.buildingId === fx.pointA && journal?.template.code === "incoming_control" ? "PASS" : "FAIL"} журнал приёмки — точки А (${journal?.template.code ?? "нет"})`,
  ];
  for (const line of lines) console.log(line);
  appendFileSync(`${DIR}/http-check.txt`, lines.join("\n") + "\n");
}

main().finally(() => db.$disconnect());
