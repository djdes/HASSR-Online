// CI (эмулятор Android): одноразовый повар для проверки «Удалить аккаунт» и
// адреса документов демо-компании. Только локальная e2e-база задания.
const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1):5432\/wesetup_e2e\b/.test(url)) throw new Error("DATABASE_URL must be the local e2e db");

async function main() {
  const bcrypt = (await import("bcryptjs")).default;
  const { db } = await import("@/lib/db");
  const org = await db.organization.findFirstOrThrow({ where: { name: "Кафе «Демо»" }, select: { id: true } });
  const email = "throwaway@cafe-demo.local";
  const passwordHash = await bcrypt.hash("DemoShots2026!", 10);
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!existing) {
    await db.user.create({
      data: { email, name: "Временный Повар", role: "cook", passwordHash, organizationId: org.id, isActive: true },
    });
  } else {
    await db.user.update({ where: { email }, data: { passwordHash, isActive: true, organizationId: org.id } });
  }
  const docs = await db.journalDocument.findMany({
    where: { organizationId: org.id, status: "active" },
    select: { id: true, title: true, template: { select: { code: true } } },
    orderBy: { dateFrom: "desc" },
  });
  const byCode: Record<string, string> = {};
  for (const d of docs) if (!byCode[d.template.code]) byCode[d.template.code] = d.id;
  const orgRow = await db.organization.findUniqueOrThrow({ where: { id: org.id }, select: { disabledJournalCodes: true } });
  const disabled = new Set((orgRow.disabledJournalCodes as string[] | null) ?? []);
  const tpls = await db.journalTemplate.findMany({ select: { code: true, fields: true } });
  const withField = (types: string[]) =>
    tpls
      .filter((t) => !disabled.has(t.code) && Array.isArray(t.fields) && (t.fields as Array<{ type?: string }>).some((f) => types.includes(String(f?.type))))
      .map((t) => t.code);
  console.log(
    JSON.stringify({ organizationId: org.id, docs: byCode, textJournals: withField(["text", "textarea"]), photoJournals: withField(["photo"]) }, null, 2)
  );
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
