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
  // 4-й круг: журнал с формой «Новая запись» (DynamicForm) и текстовым полем.
  // У демо-компании такие журналы (ccp_monitoring и др.) выключены — включаем
  // один в локальной e2e-базе, иначе форму с клавиатурой проверить не на чем.
  const { hasDocumentFillUi } = await import("@/lib/journal-document-helpers");
  const { isScanOnlyDocumentTemplate } = await import("@/lib/scan-journal-config");
  const formCandidates = tpls
    .filter((t) => !hasDocumentFillUi(t.code) && !isScanOnlyDocumentTemplate(t.code))
    .filter((t) => Array.isArray(t.fields) && (t.fields as Array<{ type?: string; showIf?: unknown }>).some((f) => ["text", "textarea"].includes(String(f?.type)) && !f?.showIf))
    .map((t) => t.code)
    .sort((a, b) => (a === "ccp_monitoring" ? -1 : b === "ccp_monitoring" ? 1 : 0));
  // Свежий сидер создаёт только активный каталог (45 журналов), и все они
  // заполняются в документе — форма `/journals/<code>/new` в CI недостижима.
  // На проде остались строки прежних журналов (isActive=false), например
  // «Мониторинг ККТ»: страница /new их открывает. Воспроизводим такую строку.
  let formTemplateCreatedByHarness: string | null = null;
  if (!formCandidates.length) {
    const fields = [
      { key: "ccpName", label: "Название ККТ", type: "text", required: true },
      { key: "controlParameter", label: "Параметр контроля", type: "text", required: true },
      { key: "criticalLimit", label: "Критический предел", type: "text", required: true },
      { key: "actualValue", label: "Фактическое значение", type: "text", required: true },
      { key: "withinLimit", label: "В пределах нормы", type: "boolean", required: true },
    ];
    await db.journalTemplate.upsert({
      where: { code: "ccp_monitoring" },
      update: {},
      create: { code: "ccp_monitoring", name: "Мониторинг ККТ", description: "Журнал мониторинга критических контрольных точек", sortOrder: 5, isMandatorySanpin: false, isMandatoryHaccp: true, fields, isActive: false },
    });
    formTemplateCreatedByHarness = "ccp_monitoring";
    formCandidates.push("ccp_monitoring");
  }
  let formTextJournals = formCandidates.filter((c) => !disabled.has(c));
  let formJournalEnabledByHarness: string | null = null;
  if (!formTextJournals.length && formCandidates.length) {
    formJournalEnabledByHarness = formCandidates[0];
    const next = [...disabled].filter((c) => c !== formJournalEnabledByHarness);
    await db.organization.update({ where: { id: org.id }, data: { disabledJournalCodes: next } });
    formTextJournals = [formJournalEnabledByHarness];
  }
  console.log(
    JSON.stringify(
      { organizationId: org.id, docs: byCode, textJournals: withField(["text", "textarea"]), photoJournals: withField(["photo"]), formTextJournals, formJournalEnabledByHarness, formTemplateCreatedByHarness },
      null,
      2
    )
  );
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
