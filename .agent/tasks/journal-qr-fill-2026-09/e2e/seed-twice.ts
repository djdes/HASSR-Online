// Второй сеяный холодильник — 2 замера в день (readingMode "twice").
import fs from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
const COLD_DOC = "cmu3e8tav00gqd7tspsb35swv";
const seed = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e/seed-objects.json"), "utf8")) as { coldItemIds: string[] };
(async () => {
  const doc = await db.journalDocument.findUniqueOrThrow({ where: { id: COLD_DOC }, select: { config: true } });
  const raw = (doc.config ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(raw.equipment) ? raw.equipment : []) as Array<Record<string, unknown>>;
  for (const item of items) if (item.id === seed.coldItemIds[1]) item.readingMode = "twice";
  await db.journalDocument.update({ where: { id: COLD_DOC }, data: { config: { ...raw, equipment: items } as Prisma.InputJsonValue } });
  console.log("twice set");
  await db.$disconnect();
})();
