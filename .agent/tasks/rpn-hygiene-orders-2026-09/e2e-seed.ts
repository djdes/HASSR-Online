/**
 * Фикстуры e2e (своя локальная база wesetup_wt_rpn): две организации,
 * руководители, сотрудники, документы гигиены (новая форма) и БЖГП,
 * токен проверяющего. Идемпотентно: пересоздаёт всё с префиксом rpn-e2e.
 *
 *   npx tsx --env-file=.env .agent/tasks/rpn-hygiene-orders-2026-09/e2e-seed.ts
 */
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";

import { db } from "@/lib/db";
import { healthDecision } from "@/lib/health-qr";
import { hashInspectorToken } from "@/lib/inspector-tokens";
import { LEGAL_VERSION } from "@/lib/legal-consent";
import { orgTodayKey } from "@/lib/timezone";

const PASSWORD = "Rpn-e2e-2026!";
const PIN = "4827";

async function main() {
  const oldOrgs = await db.organization.findMany({ where: { name: { startsWith: "rpn-e2e" } }, select: { id: true } });
  for (const org of oldOrgs) {
    await db.journalDocumentEntry.deleteMany({ where: { document: { organizationId: org.id } } });
    await db.journalDocument.deleteMany({ where: { organizationId: org.id } });
    await db.user.deleteMany({ where: { organizationId: org.id } });
    await db.organization.delete({ where: { id: org.id } }).catch(() => null);
  }

  const templates = await db.journalTemplate.findMany({
    where: { code: { in: ["hygiene", "finished_product", "health_check"] } },
    select: { id: true, code: true, name: true },
  });
  const tpl = Object.fromEntries(templates.map((t) => [t.code, t]));
  const hash = await bcrypt.hash(PASSWORD, 10);
  const timezone = "Europe/Moscow";
  const todayKey = orgTodayKey(timezone);
  const [y, m] = todayKey.split("-").map(Number);
  const dateFrom = new Date(Date.UTC(y, m - 1, 1));
  const dateTo = new Date(Date.UTC(y, m, 0));
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  const future = new Date(Date.now() + 365 * 24 * 3600 * 1000);

  const makeOrg = async (suffix: string) => {
    const org = await db.organization.create({
      data: {
        name: `rpn-e2e ${suffix}`,
        type: "restaurant",
        timezone,
        subscriptionPlan: "pro",
        subscriptionEnd: future,
      } as never,
    });
    const manager = await db.user.create({
      data: {
        email: `rpn-e2e-mgr-${suffix.toLowerCase()}@rpn.local`,
        name: `Заведующая ${suffix}`,
        passwordHash: hash,
        role: "manager",
        organizationId: org.id,
        positionTitle: "Заведующий производством",
        isActive: true,
        qrPinHash: await bcrypt.hash(PIN, 10),
        // Без окон «Мы обновили условия» и «Что нового» поверх страницы.
        legalVersion: LEGAL_VERSION,
        showWhatsNew: false,
      } as never,
    });
    return { org, manager };
  };

  const a = await makeOrg("A");
  const b = await makeOrg("B");

  const employee = (name: string, email: string) =>
    db.user.create({
      data: { email, name, passwordHash: hash, role: "cook", organizationId: a.org.id, positionTitle: "Повар", isActive: true } as never,
    });
  const ivan = await employee("Иванов Иван", "rpn-e2e-ivan@rpn.local");
  const petr = await employee("Петров Пётр", "rpn-e2e-petr@rpn.local");
  const olga = await employee("Орлова Ольга", "rpn-e2e-olga@rpn.local");

  const hygiene = await db.journalDocument.create({
    data: {
      organizationId: a.org.id,
      templateId: tpl.hygiene.id,
      title: "Гигиенический журнал (сотрудники)",
      dateFrom,
      dateTo,
      status: "active",
      config: { hygieneFormVersion: 2 },
      createdById: a.manager.id,
      responsibleUserId: a.manager.id,
    } as never,
  });
  const finished = await db.journalDocument.create({
    data: {
      organizationId: a.org.id,
      templateId: tpl.finished_product.id,
      title: "Бракеражный журнал готовой продукции",
      dateFrom,
      dateTo,
      status: "active",
      createdById: a.manager.id,
    } as never,
  });
  // Документ БЖГП чужой организации — для проверки изоляции.
  await db.journalDocument.create({
    data: {
      organizationId: b.org.id,
      templateId: tpl.finished_product.id,
      title: "Бракеражный журнал готовой продукции",
      dateFrom,
      dateTo,
      status: "active",
      createdById: b.manager.id,
    } as never,
  });

  // Иванов сегодня ответил на вопросы о здоровье (как по QR); Петров и Орлова — нет.
  const decision = healthDecision(["temperature", "infection", "respiratorySkin"]);
  await db.journalDocumentEntry.create({
    data: {
      documentId: hygiene.id,
      employeeId: ivan.id,
      date: today,
      data: { ...decision.hygiene, confirmations: decision.confirmations, source: "qr", confirmedAt: "08:05" },
    },
  });
  // Петров: только заготовка строки (как посев документа).
  await db.journalDocumentEntry.create({
    data: { documentId: hygiene.id, employeeId: petr.id, date: today, data: { _autoSeeded: true } },
  });

  // Токен проверяющего организации A.
  const rawToken = randomBytes(32).toString("base64url");
  await db.inspectorToken.create({
    data: {
      organizationId: a.org.id,
      tokenHash: hashInspectorToken(rawToken),
      label: "rpn-e2e",
      periodFrom: dateFrom,
      periodTo: dateTo,
      expiresAt: future,
      createdById: a.manager.id,
    },
  });
  const rawTokenB = randomBytes(32).toString("base64url");
  await db.inspectorToken.create({
    data: {
      organizationId: b.org.id,
      tokenHash: hashInspectorToken(rawTokenB),
      label: "rpn-e2e-b",
      periodFrom: dateFrom,
      periodTo: dateTo,
      expiresAt: future,
      createdById: b.manager.id,
    },
  });

  const fixture = {
    password: PASSWORD,
    pin: PIN,
    todayKey,
    orgA: a.org.id,
    orgB: b.org.id,
    managerA: a.manager.email,
    managerB: b.manager.email,
    cookEmail: olga.email,
    ivan: ivan.id,
    petr: petr.id,
    olga: olga.id,
    hygieneDoc: hygiene.id,
    finishedDoc: finished.id,
    inspectorToken: rawToken,
    inspectorTokenB: rawTokenB,
    checksum: createHash("sha1").update(rawToken).digest("hex").slice(0, 8),
  };
  writeFileSync(".agent/tasks/rpn-hygiene-orders-2026-09/raw/fixture.json", JSON.stringify(fixture, null, 2));
  console.log(JSON.stringify({ ...fixture, inspectorToken: "***", inspectorTokenB: "***" }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
