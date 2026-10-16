// Стенд нового меню (nav-shell-2026-10). Идемпотентный.
// Берёт организации стенда вкладок точек (3 точки / 1 точка / флаг выключен)
// и добавляет в e2e-org-loc заведующую и «проверяющего» с линейной ролью.
// Запуск: npx tsx .agent/tasks/nav-shell-2026-10/e2e/setup.ts
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import bcrypt from "bcryptjs";

import { db } from "../../journal-responsibles-org-2026-09/e2e/db";
import { LEGAL_VERSION } from "../../../../src/lib/legal-consent";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROOT = path.resolve(HERE, "..", "..", "..", "..");

async function main() {
  execFileSync("npx", ["tsx", ".agent/tasks/location-tabs-2026-09/e2e/setup.ts"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  const base = JSON.parse(
    fs.readFileSync(path.join(ROOT, ".agent/tasks/location-tabs-2026-09/e2e/state.json"), "utf8"),
  );
  const passwordHash = await bcrypt.hash(base.password, 10);
  const org = base.org as string;
  const position = await db.jobPosition.findFirst({ where: { organizationId: org, name: "Повар" } });
  if (!position) throw new Error("нет должности «Повар»");

  async function user(email: string, name: string, role: string, permissionPreset: string | null) {
    const data = {
      name,
      role,
      permissionPreset,
      organizationId: org,
      jobPositionId: position!.id,
      isActive: true,
      archivedAt: null,
      isRoot: false,
      passwordHash,
      phone: "+79990000089",
      legalVersion: LEGAL_VERSION,
      showWhatsNew: false,
      buildingIds: [],
      lastActiveBuildingId: null,
    };
    return db.user.upsert({ where: { email }, update: data, create: { email, ...data } });
  }

  const headChef = await user("nav-headchef@e2e.local", "Зоя Заведующая", "head_chef", "head_chef");
  const verifyOnly = await user("nav-verify@e2e.local", "Вера Проверяющая", "cook", "head_chef");
  // Окно «Мы обновили условия» не должно закрывать экран в смоуке.
  await db.user.updateMany({
    where: { organizationId: { in: ["e2e-org-loc", "e2e-org-loc1", "e2e-org-loc0"] } },
    data: { legalVersion: LEGAL_VERSION, showWhatsNew: false },
  });
  // Чистые документы раздела «Производственный контроль» и логотип — тест загружает сам.
  await db.knowledgeDocument.deleteMany({ where: { organizationId: org, kind: { not: null } } });
  await db.organizationLogo.deleteMany({ where: { organizationId: org } });
  await db.organization.update({ where: { id: org }, data: { logoUrl: null } });
  // QR проверяющего — свежий: тест выпускает его кнопкой.
  await db.inspectorToken.deleteMany({ where: { organizationId: org } });

  const state = {
    ...base,
    users: {
      ...base.users,
      headChef: { id: headChef.id, email: headChef.email },
      verifyOnly: { id: verifyOnly.id, email: verifyOnly.email },
    },
  };
  fs.writeFileSync(path.join(HERE, "state.json"), JSON.stringify(state, null, 2));
  console.log("OK", JSON.stringify(state.users, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
