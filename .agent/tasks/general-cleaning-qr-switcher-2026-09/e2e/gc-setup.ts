// Стенд части A (график генуборок): СВОЯ организация e2e-org-gc.
//   • руководитель gc-manager@e2e.local (известный пароль);
//   • уборщица и проверяющая — привязаны к моковому TasksFlow (:4999);
//   • помещения: «Кухня (e2e)» — каждую пятницу (уборщица + проверяющая),
//     «Склад (e2e)» — 1, 15 и последний день месяца, «Бар (e2e)» — без графика;
//   • интеграция TasksFlow с baseUrl моков; документов генуборок нет.
// Чужие e2e-организации не трогаем (setup-db.ts из journal-responsibles не запускаем).
// Запуск: npx tsx .agent/tasks/general-cleaning-qr-switcher-2026-09/e2e/gc-setup.ts
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

export const PASSWORD = "E2eTest2026!";
/** Ключ шифрования API-ключа TF — тот же задаёт gc-e2e.ts для своего процесса. */
export const E2E_KEY_SECRET = "gc-e2e-integration-key-secret-2026";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORG_ID = "e2e-org-gc";
const LEGAL_VERSION = "2026-09-22";
const FRIDAY = 1 << 4;

async function upsertPosition(name: string, categoryKey: "management" | "staff") {
  const existing = await db.jobPosition.findFirst({ where: { organizationId: ORG_ID, name } });
  if (existing) return existing;
  return db.jobPosition.create({ data: { organizationId: ORG_ID, name, categoryKey } });
}

async function upsertUser(input: {
  email: string;
  name: string;
  role: string;
  jobPositionId: string;
  phone: string;
  passwordHash: string;
}) {
  const data = {
    name: input.name,
    role: input.role,
    organizationId: ORG_ID,
    jobPositionId: input.jobPositionId,
    isActive: true,
    archivedAt: null,
    isRoot: false,
    passwordHash: input.passwordHash,
    phone: input.phone,
    legalVersion: LEGAL_VERSION,
    showWhatsNew: false,
  };
  return db.user.upsert({
    where: { email: input.email },
    update: data,
    create: { email: input.email, ...data },
  });
}

async function main() {
  process.env.INTEGRATION_KEY_SECRET = E2E_KEY_SECRET;
  const { encryptSecret } = await import("../../../../src/lib/integration-crypto");
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  await db.journalDocument.deleteMany({ where: { organizationId: ORG_ID } });
  await db.tasksFlowOutbox.deleteMany({ where: { organizationId: ORG_ID } });
  const org = await db.organization.upsert({
    where: { id: ORG_ID },
    update: {
      name: "Кафе «Генуборка»",
      isDemo: false,
      timezone: "Europe/Moscow",
      disabledJournalCodes: [],
      journalResponsibleUsersJson: {},
      autoJournalCodes: [],
      subscriptionPlan: "pro",
    },
    create: {
      id: ORG_ID,
      name: "Кафе «Генуборка»",
      type: "restaurant",
      phone: "+79990000088",
      subscriptionPlan: "pro",
      subscriptionEnd: new Date(Date.now() + 365 * 86400_000),
      isDemo: false,
      timezone: "Europe/Moscow",
    },
  });

  const posManager = await upsertPosition("Управляющий", "management");
  const posCleaner = await upsertPosition("Уборщица", "staff");
  const manager = await upsertUser({
    email: "gc-manager@e2e.local",
    name: "Галина Руководитель",
    role: "manager",
    jobPositionId: posManager.id,
    phone: "+79990000881",
    passwordHash,
  });
  const cleaner = await upsertUser({
    email: "gc-cleaner@e2e.local",
    name: "Ульяна Уборщица",
    role: "cook",
    jobPositionId: posCleaner.id,
    phone: "+79990000882",
    passwordHash,
  });
  const verifier = await upsertUser({
    email: "gc-verifier@e2e.local",
    name: "Вера Проверяющая",
    role: "head_chef",
    jobPositionId: posManager.id,
    phone: "+79990000883",
    passwordHash,
  });

  const building =
    (await db.building.findFirst({ where: { organizationId: ORG_ID } })) ??
    (await db.building.create({ data: { organizationId: ORG_ID, name: "Основная точка" } }));
  const rooms = [
    {
      name: "Кухня (e2e)",
      kind: "kitchen",
      generalScheduleType: "weekly",
      generalDays: FRIDAY,
      generalMonthDays: [],
      cleanerUserIds: [cleaner.id],
      verifierUserIds: [verifier.id],
      sortOrder: 1,
    },
    {
      name: "Склад (e2e)",
      kind: "storage",
      generalScheduleType: "monthly",
      generalDays: 0,
      generalMonthDays: ["1", "15", "last"],
      cleanerUserIds: [],
      verifierUserIds: [],
      sortOrder: 2,
    },
    {
      name: "Бар (e2e)",
      kind: "bar",
      generalScheduleType: "weekly",
      generalDays: 0,
      generalMonthDays: [],
      cleanerUserIds: [],
      verifierUserIds: [],
      sortOrder: 3,
    },
  ];
  const roomIds: Record<string, string> = {};
  for (const room of rooms) {
    const existing = await db.room.findFirst({ where: { buildingId: building.id, name: room.name } });
    const saved = existing
      ? await db.room.update({ where: { id: existing.id }, data: room })
      : await db.room.create({ data: { buildingId: building.id, ...room } });
    roomIds[room.name] = saved.id;
  }

  const integration = await db.tasksFlowIntegration.upsert({
    where: { organizationId: ORG_ID },
    update: {
      baseUrl: "http://127.0.0.1:4999",
      apiKeyEncrypted: encryptSecret("tfk_gc_e2e_key_0000000000"),
      apiKeyPrefix: "tfk_gc_e2e_k",
      enabled: true,
    },
    create: {
      organizationId: ORG_ID,
      baseUrl: "http://127.0.0.1:4999",
      apiKeyEncrypted: encryptSecret("tfk_gc_e2e_key_0000000000"),
      apiKeyPrefix: "tfk_gc_e2e_k",
      webhookSecret: "gc-e2e-webhook-secret",
      enabled: true,
    },
  });
  await db.tasksFlowTaskLink.deleteMany({ where: { integrationId: integration.id } });
  await db.tasksFlowUserLink.deleteMany({ where: { integrationId: integration.id } });
  for (const [user, tfId] of [
    [cleaner, 501],
    [verifier, 502],
    [manager, 503],
  ] as const) {
    await db.tasksFlowUserLink.create({
      data: {
        integrationId: integration.id,
        wesetupUserId: user.id,
        phone: user.phone ?? "",
        tasksflowUserId: tfId,
      },
    });
  }

  const state = {
    password: PASSWORD,
    orgId: org.id,
    managerEmail: manager.email,
    managerId: manager.id,
    cleanerId: cleaner.id,
    verifierId: verifier.id,
    integrationId: integration.id,
    roomIds,
  };
  fs.writeFileSync(path.join(HERE, "gc-state.json"), JSON.stringify(state, null, 2));
  console.log(JSON.stringify(state, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
