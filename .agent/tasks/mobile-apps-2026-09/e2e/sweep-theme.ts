// Тема пользователя в e2e-базе: THEME=dark|restore EMAIL=... (исходное значение — в d:/wt/tmp/sweep/theme-<email>.json).
import fs from "node:fs";
import { db } from "./server-db";
(async () => {
  const email = process.env.EMAIL!;
  const file = `d:/wt/tmp/sweep/theme-${email}.json`;
  if (process.env.THEME === "restore") {
    const prev = JSON.parse(fs.readFileSync(file, "utf8"));
    await db.user.update({ where: { email }, data: { themePreference: prev.themePreference } });
    console.log("restored", email, prev.themePreference);
  } else {
    const u = await db.user.findUniqueOrThrow({ where: { email }, select: { themePreference: true } });
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(u));
    await db.user.update({ where: { email }, data: { themePreference: process.env.THEME } });
    console.log("was", u.themePreference, "now", process.env.THEME);
  }
  await db.$disconnect();
})();
