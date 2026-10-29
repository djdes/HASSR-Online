// PIN 2468 руководителю тестовой организации — только e2e-база.
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_e2e")) throw new Error("e2e only");
  const seed = JSON.parse(readFileSync(".agent/tasks/journals-point-mode-2026-10-28/raw/seed.json", "utf8"));
  const updated = await db.user.updateMany({ where: { email: seed.manager }, data: { qrPinHash: await bcrypt.hash("2468", 10) } });
  console.log("pin set:", updated.count);
}
main().finally(() => db.$disconnect());
