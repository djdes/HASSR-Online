// Дополнение к shots-seed.ts / shots-claims.ts для iOS-проверки в CI (только e2e-база):
// одноразовый повар для удаления аккаунта, полевой журнал с голосовым вводом и
// адреса документов, которые открывает тест. Пишет JSON в путь из argv[2].
// Запуск: DATABASE_URL=<e2e> npx tsx .agent/tasks/mobile-e2e-ios-2026-09/ci-extra.ts out.json
import fs from "node:fs";

const E2E = "postgresql://postgres:postgres@localhost:5432/wesetup_e2e?sslmode=disable";
if (process.env.DATABASE_URL !== E2E) throw new Error("DATABASE_URL must be the e2e db");

// Полевой журнал: textarea с кнопкой «Голосовой ввод» и поле «Снять фото».
const VOICE_FIELDS = [
  { key: "note", label: "Заметка", type: "textarea" },
  { key: "photo", label: "Фото", type: "photo" },
];

export const THROWAWAY_EMAIL = "delete-me@cafe-demo.local";

async function main() {
  const out = process.argv[2] ?? "ci-ids.json";
  const bcrypt = (await import("bcryptjs")).default;
  const { db } = await import("@/lib/db");
  const org = await db.organization.findFirstOrThrow({ where: { name: "Кафе «Демо»" }, select: { id: true } });
  const hash = await bcrypt.hash("DemoShots2026!", 10);
  const existing = await db.user.findUnique({ where: { email: THROWAWAY_EMAIL }, select: { id: true } });
  const throwaway = existing
    ? await db.user.update({ where: { id: existing.id }, data: { passwordHash: hash, isActive: true }, select: { id: true } })
    : await db.user.create({
        data: {
          email: THROWAWAY_EMAIL,
          name: "Удаляев Тест Одноразович",
          role: "cook",
          positionTitle: "Повар",
          passwordHash: hash,
          organizationId: org.id,
          isActive: true,
        },
        select: { id: true },
      });
  await db.journalTemplate.upsert({
    where: { code: "e2e_voice" },
    create: { code: "e2e_voice", name: "E2E голос и фото", fields: VOICE_FIELDS },
    update: { fields: VOICE_FIELDS },
  });
  const doc = async (code: string) =>
    (
      await db.journalDocument.findFirst({
        where: { organizationId: org.id, template: { code }, status: "active" },
        orderBy: { dateFrom: "desc" },
        select: { id: true, title: true },
      })
    ) ?? null;
  const users = await db.user.findMany({
    where: { organizationId: org.id },
    select: { id: true, email: true, name: true, role: true, positionTitle: true },
  });
  const cook = users.find((u) => u.email === "cook@cafe-demo.local");
  const cookClaim = cook
    ? await db.journalTaskClaim.findFirst({
        where: { userId: cook.id, status: "active" },
        select: { id: true, journalCode: true, scopeLabel: true },
      })
    : null;
  const anyActiveClaim = await db.journalTaskClaim.findFirst({
    where: { organizationId: org.id, status: "active" },
    select: { id: true, journalCode: true, scopeLabel: true, userId: true },
  });
  const templates = await db.journalDocument.findMany({
    where: { organizationId: org.id, status: "active" },
    select: { id: true, title: true, template: { select: { code: true } } },
    take: 80,
  });
  const result = {
    organizationId: org.id,
    throwawayId: throwaway.id,
    docs: {
      cleaning: await doc("cleaning"),
      cold: await doc("cold_equipment_control"),
      hygiene: await doc("hygiene"),
    },
    cookClaim,
    anyActiveClaim,
    users,
    activeDocs: templates.map((d) => ({ id: d.id, code: d.template.code, title: d.title })),
  };
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, users: users.length, activeDocs: templates.length }, null, 2));
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
