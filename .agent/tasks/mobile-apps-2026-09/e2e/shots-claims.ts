// Задачи смены «на сегодня» для скриншотов (только e2e-база): часть задач
// «Кафе «Демо»» закрыта сотрудниками утром (одни подтверждены, другие ждут
// проверки), пара — в работе, вечерние свободны. Повторный запуск
// пересоздаёт сегодняшние задачи организации.
// Запуск из d:/wt/mobile-apps: DATABASE_URL=<e2e> npx tsx .agent/tasks/mobile-apps-2026-09/e2e/shots-claims.ts
const E2E = "postgresql://postgres:postgres@localhost:5432/wesetup_e2e?sslmode=disable";
if (process.env.DATABASE_URL !== E2E) throw new Error("DATABASE_URL must be the e2e db");

async function main() {
  const { db } = await import("@/lib/db");
  const { generatePoolForDay } = await import("@/lib/journal-task-pool");
  const { resolveDayStart } = await import("@/lib/today-compliance");
  const org = await db.organization.findFirstOrThrow({ where: { name: "Кафе «Демо»" }, select: { id: true, timezone: true } });
  const today = resolveDayStart(org.timezone, new Date());
  const tomorrow = new Date(today.getTime() + 86400000);
  const users = await db.user.findMany({ where: { organizationId: org.id }, select: { id: true, name: true, positionTitle: true } });
  const by = (pos: string) => users.find((u) => u.positionTitle === pos)!;
  const chef = by("Шеф-повар"), sous = by("Су-шеф"), hot = by("Повар горячего цеха"), cold = by("Повар холодного цеха"),
    cleaner = by("Уборщик"), store = by("Кладовщик"), tech = by("Технолог"), cook = by("Повар");
  await db.journalTaskClaim.deleteMany({ where: { organizationId: org.id, dateKey: { gte: today, lt: tomorrow } } });

  const at = (hm: string) => new Date(`${today.toISOString().slice(0, 10)}T${hm}:00+03:00`);
  type Plan = { user: typeof chef; status: "completed" | "active"; v?: "approved" | "pending"; t: string };
  const rules: Array<[string, RegExp, Plan]> = [
    ["hygiene", /./, { user: chef, status: "completed", v: "approved", t: "08:05" }],
    ["cold_equipment_control", /Горячий|№1.*Утро|ларь.*Утро/, { user: hot, status: "completed", v: "approved", t: "08:20" }],
    ["cold_equipment_control", /№2.*Утро|№3.*Утро/, { user: cold, status: "completed", v: "pending", t: "08:35" }],
    ["climate_control", /Утро/, { user: store, status: "completed", v: "approved", t: "09:10" }],
    ["cleaning", /Уборка · (Горячий цех|Холодный цех|Моечная)/, { user: cleaner, status: "completed", v: "approved", t: "09:40" }],
    ["cleaning", /Уборка · Гостевой зал/, { user: cleaner, status: "completed", v: "pending", t: "11:30" }],
    ["cleaning", /Уборка · Санузел/, { user: cleaner, status: "active", t: "12:50" }],
    ["incoming_control", /./, { user: store, status: "completed", v: "pending", t: "10:50" }],
    ["finished_product", /Завтрак/, { user: sous, status: "completed", v: "approved", t: "09:00" }],
    ["finished_product", /Обед/, { user: chef, status: "active", t: "12:40" }],
    ["fryer_oil", /./, { user: hot, status: "completed", v: "pending", t: "11:05" }],
    ["disinfectant_usage", /./, { user: tech, status: "completed", v: "approved", t: "09:25" }],
    ["uv_lamp_runtime", /./, { user: cook, status: "active", t: "12:55" }],
  ];
  const codes = Array.from(new Set(rules.map((r) => r[0])));
  let n = 0;
  const report: string[] = [];
  for (const code of codes) {
    const pool = await generatePoolForDay({ organizationId: org.id, journalCode: code, date: today });
    for (const s of pool.scopes) {
      const rule = rules.find(([c, re]) => c === code && re.test(s.scopeLabel));
      if (!rule) {
        report.push(`free  ${code} | ${s.scopeLabel}`);
        continue;
      }
      const p = rule[2];
      const time = at(p.t);
      await db.journalTaskClaim.create({
        data: {
          organizationId: org.id,
          journalCode: code,
          scopeKey: s.scopeKey,
          scopeLabel: s.scopeLabel,
          dateKey: today,
          userId: p.user.id,
          status: p.status,
          claimedAt: new Date(time.getTime() - 10 * 60000),
          completedAt: p.status === "completed" ? time : null,
          verificationStatus: p.status === "completed" ? p.v ?? null : null,
          verifiedById: p.v === "approved" ? tech.id : null,
          verifiedAt: p.v === "approved" ? new Date(time.getTime() + 25 * 60000) : null,
        },
      });
      n++;
      report.push(`${p.status.padEnd(9)} ${code} | ${s.scopeLabel} | ${p.user.name}`);
    }
  }

  // Колокольчик шеф-повара: те же виды уведомлений, что шлёт сайт
  // (допуск по гигиене, запрос PIN, не отметился по QR).
  const hygieneDoc = await db.journalDocument.findFirst({
    where: { organizationId: org.id, template: { code: "hygiene" }, status: "active" },
    select: { id: true },
  });
  const hygieneHref = hygieneDoc ? `/journals/hygiene/documents/${hygieneDoc.id}` : "/journals";
  const dayKey = today.toISOString().slice(0, 10);
  const ago = (min: number) => new Date(Date.now() - min * 60000);
  const pavlov = cook, fed = by("Официант"), step = by("Посудомойщик");
  await db.notification.deleteMany({ where: { organizationId: org.id } });
  const pinHref = "/settings/users?pinRequests=1#pin-requests";
  const notes = [
    {
      kind: "hygiene-admission",
      dedupeKey: `hygiene-admission:${hygieneDoc?.id}:${dayKey}`,
      title: "Гигиенический журнал: сотрудники ждут допуска",
      linkHref: hygieneHref,
      linkLabel: "Открыть журнал",
      items: [
        { id: pavlov.id, label: `${pavlov.name} — подписал, ждёт допуска`, hint: "07:45" },
        { id: hot.id, label: `${hot.name} — подписал, ждёт допуска`, hint: "07:48" },
      ],
      createdAt: ago(12),
    },
    {
      kind: "qr_pin_request",
      dedupeKey: `qr-pin-requests:${org.id}`,
      title: "Запросы PIN от сотрудников",
      linkHref: pinHref,
      linkLabel: "Рассмотреть",
      items: [{ id: `pin-${step.id}`, label: `${step.name} — новый pin`, hint: "с QR-страницы", href: pinHref }],
      createdAt: ago(40),
    },
    {
      kind: "health-qr-missing",
      dedupeKey: `health-qr-missing:${dayKey}`,
      title: "Не отметились по QR гигиенического журнала: 1",
      linkHref: hygieneHref,
      linkLabel: "Открыть журнал",
      items: [{ id: step.id, label: step.name, hint: "не отметился" }],
      createdAt: ago(95),
    },
  ];
  for (const note of notes) await db.notification.create({ data: { organizationId: org.id, userId: chef.id, ...note } });
  report.push(`notifications for ${chef.name}: ${notes.length}`);

  // Гигиенический журнал по новой форме (v2): сегодня сотрудники подписали
  // три графы по QR, шеф-повар дал допуск; Павлов и Лебедев ждут допуска,
  // Степанов ещё не отметился (как в уведомлениях выше).
  if (hygieneDoc) {
    const todayLocal = today;
    const entries = await db.journalDocumentEntry.findMany({
      where: { documentId: hygieneDoc.id, date: todayLocal },
      select: { id: true, employeeId: true, data: true },
      orderBy: { employee: { name: "asc" } },
    });
    const waiting = new Set([pavlov.id, hot.id]);
    let k = 0;
    for (const e of entries) {
      const data = (e.data ?? {}) as Record<string, unknown>;
      if (data.status !== "healthy" || e.employeeId === step.id) continue;
      k++;
      const verifier = e.employeeId === chef.id ? sous : chef;
      const next: Record<string, unknown> = {
        ...data,
        confirmations: { temperature: true, infection: true, respiratorySkin: true },
        confirmedAt: `07:${String(30 + k * 3).padStart(2, "0")}`,
        source: "qr",
      };
      delete next._autoSeeded;
      if (!waiting.has(e.employeeId)) {
        next.verification = {
          result: "admitted",
          byUserId: verifier.id,
          byName: verifier.name,
          byTitle: verifier.positionTitle,
          at: `08:${String(k * 2).padStart(2, "0")}`,
          method: "qr",
        };
      } else delete next.verification;
      await db.journalDocumentEntry.update({ where: { id: e.id }, data: { data: next as object } });
    }
    report.push(`hygiene v2 marks today: ${k}`);
  }

  // Бот подключён у всей команды (фейковые chat id — стенд работает с
  // ненастоящим токеном бота), иначе панель контроля кричит «N без Telegram».
  const staff = await db.user.findMany({ where: { organizationId: org.id }, select: { id: true }, orderBy: { name: "asc" } });
  for (let i = 0; i < staff.length; i++) {
    await db.user.update({ where: { id: staff[i].id }, data: { telegramChatId: String(7100000100 + i) } });
  }
  report.push(`telegram linked: ${staff.length}`);

  console.log(report.join("\n"));
  console.log("claims created", n, "day", today.toISOString());
  await db.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
