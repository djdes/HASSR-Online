/* eslint-disable no-console */
// Включает журнал бракеража в тестовой организации (enable) или возвращает список отключённых (restore).
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
const ORG = "cmoe6rpt4000097ts71yb922y";
const STATE = path.resolve(process.cwd(), ".agent/tasks/journal-qr-fill-2026-09/e2e/enable-fp.json");
(async () => {
  const org = await db.organization.findUniqueOrThrow({ where: { id: ORG }, select: { disabledJournalCodes: true } });
  const codes = (org.disabledJournalCodes as string[] | null) ?? [];
  if (process.argv[2] === "restore") {
    const saved = JSON.parse(fs.readFileSync(STATE, "utf8")) as string[];
    await db.organization.update({ where: { id: ORG }, data: { disabledJournalCodes: saved } });
    console.log("restored", saved.length);
  } else {
    fs.writeFileSync(STATE, JSON.stringify(codes));
    await db.organization.update({ where: { id: ORG }, data: { disabledJournalCodes: codes.filter((c) => c !== "finished_product") } });
    console.log("was disabled:", codes.join(","), "| finished_product enabled");
  }
  await db.$disconnect();
})();
