/**
 * Живая проверка шага «звонки» на отдельной базе: настоящий Телфин и Groq.
 * DATABASE_URL — пустая база с текущей схемой; ключи — из окружения.
 */
import { db } from "@/lib/db";
import { syncTelphinCalls } from "@/lib/crm/telphin.server";

async function main() {
  // Клиент платформы с номером из истории звонков — звонок должен попасть к его организации.
  const org = await db.organization.upsert({
    where: { id: "e2e-org-telphin" },
    create: { id: "e2e-org-telphin", name: "Кафе «Проверка звонков»", type: "restaurant" },
    update: {},
  });
  await db.user.upsert({
    where: { email: "e2e-telphin@example.com" },
    create: { email: "e2e-telphin@example.com", name: "Клиент по телефону", phone: "8 (993) 917-32-79", organizationId: org.id, role: "owner", passwordHash: "x" },
    update: {},
  });
  // Повторная проверка — с чистой ленты и курсора, записи остаются на диске.
  await db.crmContact.deleteMany({});
  await db.crmInteraction.deleteMany({});
  await db.platformSetting.deleteMany({ where: { key: "crm:cursor:telphin" } });
  for (let run = 1; run <= 3; run += 1) {
    const result = await syncTelphinCalls(new Date());
    console.log(`прогон ${run}:`, JSON.stringify(result));
  }
  const contacts = await db.crmContact.findMany({ include: { interactions: { include: { call: true }, orderBy: { occurredAt: "asc" } } } });
  console.log("контактов:", contacts.length);
  for (const c of contacts) {
    console.log(`— ${c.phone} | ${c.name ?? ""} | org=${c.organizationId ?? "-"} | stage=${c.stage} | ждёт=${c.awaitingSince?.toISOString() ?? "-"}`);
    for (const i of c.interactions) {
      const call = i.call;
      console.log(`    ${i.occurredAt.toISOString()} ${i.channel}/${i.direction} ${i.authorName ?? ""} | audio=${call?.audioStatus} ${call?.fileSize ?? ""} | text=${call?.transcriptStatus} ${call?.transcript ? JSON.stringify(call.transcript.slice(0, 80)) : ""}`);
    }
  }
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
