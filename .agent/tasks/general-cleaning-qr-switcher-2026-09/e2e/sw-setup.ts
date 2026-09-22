// Стенд переключателя журналов (часть B): СВОЯ организация e2e-org-sw,
// руководитель и повар с известным паролем, три выключенных журнала.
// Чужие e2e-организации не трогаем (setup-db.ts из journal-responsibles не запускаем).
// Запуск: npx tsx .agent/tasks/general-cleaning-qr-switcher-2026-09/e2e/sw-setup.ts
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";

export const PASSWORD = "E2eTest2026!";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ORG_ID = "e2e-org-sw";
/** Выключенные в наборе: бракераж скоропорта, фритюр, стекло. */
const DISABLED = ["perishable_rejection", "fryer_oil", "glass_control"];
/** Текущая редакция документов — чтобы окно «Мы обновили условия» не мешало. */
const LEGAL_VERSION = "2026-09-22";

async function upsertPosition(organizationId: string, name: string, categoryKey: "management" | "staff") {
  const existing = await db.jobPosition.findFirst({ where: { organizationId, name } });
  if (existing) return existing;
  return db.jobPosition.create({ data: { organizationId, name, categoryKey } });
}

async function upsertUser(input: {
  email: string;
  name: string;
  role: string;
  jobPositionId: string;
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
    phone: "+79990000077",
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
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  await db.journalDocument.deleteMany({ where: { organizationId: ORG_ID } });
  const org = await db.organization.upsert({
    where: { id: ORG_ID },
    update: {
      name: "Кафе «Свитч»",
      isDemo: false,
      disabledJournalCodes: DISABLED,
      journalResponsibleUsersJson: {},
      autoJournalCodes: [],
    },
    create: {
      id: ORG_ID,
      name: "Кафе «Свитч»",
      type: "restaurant",
      phone: "+79990000077",
      subscriptionPlan: "pro",
      subscriptionEnd: new Date(Date.now() + 365 * 86400_000),
      isDemo: false,
      disabledJournalCodes: DISABLED,
    },
  });

  const posManager = await upsertPosition(org.id, "Управляющий", "management");
  const posCook = await upsertPosition(org.id, "Повар", "staff");
  const manager = await upsertUser({
    email: "sw-manager@e2e.local",
    name: "Светлана Руководитель",
    role: "manager",
    jobPositionId: posManager.id,
    passwordHash,
  });
  const cook = await upsertUser({
    email: "sw-cook@e2e.local",
    name: "Семён Повар",
    role: "cook",
    jobPositionId: posCook.id,
    passwordHash,
  });
  // Повар без миграции ACL видит все журналы — как новый сотрудник.
  await db.userJournalAccess.deleteMany({ where: { userId: cook.id } }).catch(() => null);

  const state = {
    password: PASSWORD,
    org: org.id,
    disabled: DISABLED,
    users: {
      manager: { id: manager.id, email: manager.email, name: manager.name },
      cook: { id: cook.id, email: cook.email, name: cook.name },
    },
  };
  fs.writeFileSync(path.join(HERE, "sw-state.json"), JSON.stringify(state, null, 2));
  console.log("OK", JSON.stringify(state, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
