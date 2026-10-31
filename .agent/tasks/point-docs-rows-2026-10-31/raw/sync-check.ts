/**
 * e2e-БД (НЕ прод): автоочистка старых документов точки А (AC1, AC2).
 * node --import tsx .agent/tasks/point-docs-rows-2026-10-31/raw/sync-check.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

import { db } from "@/lib/db";
import { syncPointDocumentRows } from "@/lib/point-document-rows-sync";

const DIR = ".agent/tasks/point-docs-rows-2026-10-31/raw";

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_e2e")) throw new Error("e2e only");
  const fx = JSON.parse(readFileSync(`${DIR}/fixture.json`, "utf8"));
  const out: string[] = [];
  const check = (name: string, ok: boolean, detail = "") => {
    const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
    out.push(line);
    console.log(line);
  };
  const fixed = await syncPointDocumentRows(fx.orgId);
  check("автоочистка поправила 2 документа (генуборки и уборка)", fixed === 2, `исправлено ${fixed}`);
  const general = await db.journalDocument.findUniqueOrThrow({ where: { id: fx.generalId }, select: { config: true } });
  const rows = ((general.config as { rows: Array<{ roomName: string }> }).rows ?? []).map((row) => row.roomName);
  check("генуборки: своё помещение осталось", rows.includes("Кухня точки А"), rows.join(", "));
  check("генуборки: помещение точки Б без отметок убрано", !rows.includes("Кухня точки Б"));
  check("генуборки: помещение точки Б с отмеченной уборкой осталось", rows.includes("Склад точки Б"));
  const cleaning = await db.journalDocument.findUniqueOrThrow({ where: { id: fx.cleaningId }, select: { config: true } });
  const c = cleaning.config as {
    selectedRoomIds: string[];
    selectedCleanerUserIds: string[];
    cleaningResponsibles: Array<{ userId: string }>;
    controlResponsibles: Array<{ userId: string }>;
  };
  check("уборка: помещение точки Б убрано", JSON.stringify(c.selectedRoomIds) === JSON.stringify([fx.rooms.roomA]));
  check(
    "уборка: уборщики — Анна и Вера, без Бориса",
    JSON.stringify(c.selectedCleanerUserIds) === JSON.stringify([fx.users.anna, fx.users.vera]),
  );
  check("уборка: ответственные — без Бориса", !c.cleaningResponsibles.some((item) => item.userId === fx.users.boris) && c.cleaningResponsibles.length === 1);
  check("уборка: контролёр точки Б убран", c.controlResponsibles.length === 0);
  const again = await syncPointDocumentRows(fx.orgId);
  check("повторная автоочистка ничего не меняет", again === 0, `исправлено ${again}`);
  writeFileSync(`${DIR}/sync-check.txt`, out.join("\n") + "\n");
  const failed = out.filter((line) => line.startsWith("FAIL")).length;
  console.log(failed === 0 ? `ALL PASS (${out.length})` : `FAILED ${failed}/${out.length}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().finally(() => db.$disconnect());
