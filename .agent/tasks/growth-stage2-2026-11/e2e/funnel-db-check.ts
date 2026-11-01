/**
 * Проверка воронки на настоящей базе (локальный стенд wesetup_e2e):
 * заводит организации с разными источниками, записями, командой и оплатой,
 * зовёт `loadSignupFunnel` (тот же запрос, что /root/funnel) и печатает итог.
 * Запуск: npx tsx .agent/tasks/growth-stage2-2026-11/e2e/funnel-db-check.ts [--keep]
 */
import { db } from "@/lib/db";
import { loadSignupFunnel } from "@/lib/signup-funnel.server";

const TAG = "funnel-e2e";
const now = new Date();
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

async function cleanup() {
  const orgs = await db.organization.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  const ids = orgs.map((org) => org.id);
  if (!ids.length) return;
  await db.paymentOrder.deleteMany({ where: { organizationId: { in: ids } } });
  await db.journalDocument.deleteMany({ where: { organizationId: { in: ids } } });
  await db.journalEntry.deleteMany({ where: { organizationId: { in: ids } } });
  await db.user.deleteMany({ where: { organizationId: { in: ids } } });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
}

async function org(name: string, createdAt: Date, source: Record<string, string> | null, users: Array<{ phone: string | null }>) {
  const created = await db.organization.create({
    data: { name: `${TAG} ${name}`, type: "cafe", createdAt, ...(source ? { signupSourceJson: source } : {}) },
  });
  let index = 0;
  for (const user of users) {
    await db.user.create({
      data: {
        email: `${TAG}-${created.id}-${index}@example.test`,
        name: `${name} ${index}`,
        role: index === 0 ? "manager" : "cook",
        organizationId: created.id,
        phone: user.phone,
        passwordHash: "e2e-not-a-real-hash",
        createdAt: new Date(createdAt.getTime() + index * 1000),
      },
    });
    index += 1;
  }
  return created;
}

async function main() {
  await cleanup();
  const template = await db.journalTemplate.findFirstOrThrow({ where: { code: "hygiene" } });

  const direct = await org("Директ", daysAgo(1), { place: "hero", landing: "/dlya-kafe", referrer: "", utmSource: "yandex", utmMedium: "cpc", utmCampaign: "kafe" }, [{ phone: "+79990000001" }, { phone: null }]);
  const search = await org("Поиск", daysAgo(2), { place: "final", landing: "/", referrer: "https://yandex.ru/search/", utmSource: "", utmMedium: "", utmCampaign: "" }, [{ phone: "+79990000002" }]);
  await org("Старая", daysAgo(20), null, [{ phone: null }]);

  // «Директ»: запись в журнале-документе, два сотрудника, оплата тарифа.
  const owner = await db.user.findFirstOrThrow({ where: { organizationId: direct.id, role: "manager" } });
  const document = await db.journalDocument.create({
    data: { templateId: template.id, organizationId: direct.id, title: "Гигиенический журнал", dateFrom: daysAgo(1), dateTo: now },
  });
  await db.journalDocumentEntry.create({ data: { documentId: document.id, employeeId: owner.id, date: daysAgo(0), data: { healthStatus: "healthy" } } });
  await db.paymentOrder.create({
    data: { email: owner.email ?? "x@example.test", tariffKey: "standard_year", amountRub: 23880, description: "e2e", status: "paid", organizationId: direct.id, paidAt: now },
  });
  // «Поиск»: только пополнение баланса — оплатой тарифа не считается.
  await db.paymentOrder.create({
    data: { email: "y@example.test", tariffKey: "balance_topup", amountRub: 500, description: "e2e", status: "paid", organizationId: search.id, paidAt: now },
  });

  const funnel = await loadSignupFunnel(now);
  console.log(JSON.stringify({ total: funnel.total.counts, channels: funnel.channels.map((row) => [row.label, row.counts]) }, null, 2));
  if (!process.argv.includes("--keep")) await cleanup();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
