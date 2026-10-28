/**
 * Тестовые данные для локальной проверки памяток (только отдельная база
 * wesetup_memos на 127.0.0.1:5432, НЕ прод):
 * - «org-dk»: журналы по точкам, офис + три точки (одна с длинным
 *   «наименованием для журналов»), гигиенический журнал у двух точек, у
 *   «Кафе на Мира» документа нет (QR создаст его при первом скане);
 * - «org-one»: одна точка, журналы общие, свой сайт организации;
 * - «org-none»: точек нет, гигиенический журнал выключен.
 * Пользователи: владельцы (admin) трёх организаций и админ «org-dk», которому
 * доступна только первая точка.
 * Запуск: npx tsx .agent/tasks/memos-point-2026-10-28/raw/seed-local.ts
 */
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { LEGAL_VERSION } from "@/lib/legal-consent";

const LONG_JOURNAL_NAME =
  "МАУ «Комбинат питания «Дружба», пищеблок МБОУ «Средняя общеобразовательная школа № 112 с углублённым изучением отдельных предметов имени А. С. Пушкина», г. Казань, проспект Победы, 100, корпус 2";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("/wesetup_memos")) throw new Error("Только тестовая база wesetup_memos");
  const passwordHash = await bcrypt.hash("Test-12345", 10);
  const hygiene = await db.journalTemplate.findUniqueOrThrow({ where: { code: "hygiene" }, select: { id: true } });

  const orgs = [
    { id: "org-dk", name: "МАУ «КП «ДК»", perLocationJournals: true, website: null, disabledJournalCodes: [] as string[] },
    { id: "org-one", name: "Доброе кафе", perLocationJournals: false, website: "dobroe-kafe.ru", disabledJournalCodes: [] as string[] },
    { id: "org-none", name: "Кафе без точек", perLocationJournals: false, website: null, disabledJournalCodes: ["hygiene"] },
  ];
  for (const org of orgs) {
    const { id, ...fields } = org;
    await db.organization.upsert({
      where: { id },
      update: fields,
      create: { ...org, type: "restaurant" },
    });
  }

  const buildings = [
    { id: "b-dk-office", organizationId: "org-dk", name: "Офис", kind: "office", sortOrder: 0, address: null, journalName: null },
    { id: "b-dk-5", organizationId: "org-dk", name: "Пищеблок СОШ № 5", kind: "point", sortOrder: 1, address: "г. Казань, ул. Ленина, 5", journalName: null },
    { id: "b-dk-112", organizationId: "org-dk", name: "Пищеблок гимназии № 112", kind: "point", sortOrder: 2, address: "г. Казань, пр. Победы, 100", journalName: LONG_JOURNAL_NAME },
    { id: "b-dk-mira", organizationId: "org-dk", name: "Кафе на Мира", kind: "point", sortOrder: 3, address: null, journalName: null },
    { id: "b-one", organizationId: "org-one", name: "Доброе кафе на Садовой", kind: "point", sortOrder: 0, address: "ул. Садовая, 7", journalName: null },
  ];
  for (const building of buildings) {
    await db.building.upsert({
      where: { id: building.id },
      update: { name: building.name, address: building.address, journalName: building.journalName, kind: building.kind },
      create: building,
    });
  }

  const now = new Date();
  const dateFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dateTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const documents = [
    { id: "doc-hyg-dk-5", organizationId: "org-dk", buildingId: "b-dk-5" },
    { id: "doc-hyg-dk-112", organizationId: "org-dk", buildingId: "b-dk-112" },
    { id: "doc-hyg-one", organizationId: "org-one", buildingId: null },
  ];
  // «Кафе на Мира» — новая точка без документа гигиенического журнала.
  await db.journalDocument.deleteMany({ where: { organizationId: "org-dk", buildingId: "b-dk-mira" } });
  for (const document of documents) {
    await db.journalDocument.upsert({
      where: { id: document.id },
      update: {},
      create: { ...document, templateId: hygiene.id, title: "Гигиенический журнал", dateFrom, dateTo },
    });
  }

  const users = [
    { id: "u-dk-owner", email: "dk-owner@test.local", name: "Ольга Руководитель", organizationId: "org-dk", buildingIds: [] as string[] },
    { id: "u-dk-admin5", email: "dk-admin5@test.local", name: "Пётр Админ точки", organizationId: "org-dk", buildingIds: ["b-dk-5"] },
    { id: "u-one-owner", email: "one-owner@test.local", name: "Анна Владелец", organizationId: "org-one", buildingIds: [] as string[] },
    { id: "u-none-owner", email: "none-owner@test.local", name: "Иван Владелец", organizationId: "org-none", buildingIds: [] as string[] },
  ];
  for (const user of users) {
    await db.user.upsert({
      where: { email: user.email },
      update: { passwordHash, legalVersion: LEGAL_VERSION, showWhatsNew: false, buildingIds: user.buildingIds },
      create: {
        ...user,
        role: "owner",
        permissionPreset: "admin",
        isActive: true,
        journalAccessMigrated: true,
        passwordHash,
        phone: "+79990000000",
        legalVersion: LEGAL_VERSION,
        showWhatsNew: false,
      },
    });
  }
  console.log("seeded", orgs.map((org) => org.id).join(", "));
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exit(1);
  });
