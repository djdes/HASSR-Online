/**
 * One-shot: шапка «УТВЕРЖДАЮ» с должностью одного человека и ФИО другого.
 *
 * Откуда взялось: при создании графика ген. уборок утверждающий (слот
 * `manager`) не брался из диалога, а подбирался автоматикой — линейный
 * персонал первым, отсюда повар. Каскад слотов менял ФИО, но не должность.
 * В итоге в шапке «Заведующий производством» рядом с ФИО повара. Код
 * поправлен (создание, каскад, показ); здесь — починка уже созданных
 * документов.
 *
 * Кого трогаем: активные документы журналов с «УТВЕРЖДАЮ» (general_cleaning,
 * training_plan, audit_plan, equipment_calibration, equipment_maintenance),
 * у которых должность человека `approveEmployeeId` ≠ `approveRole`. Решение
 * — `decideApproverFix` (src/lib/approver-display.ts):
 *   1. должность ответственного документа = approveRole → утверждающий =
 *      ответственный;
 *   2. иначе ровно один сотрудник с этой должностью → он;
 *   3. иначе человек остаётся, approveRole = его настоящая должность.
 *
 * Плюс: у активных графиков ген. уборок с пустым списком помещений строки
 * заполняются из помещений организации (/settings/buildings) — так же, как
 * это теперь делает создание документа. Заполненные графики не трогаем.
 *
 * Однократно: после боевого прогона пишем PlatformSetting
 * `once:approver-mismatch:v1`, следующие деплои выходят сразу — иначе
 * утверждающий, которого менеджер потом сознательно поставил «не по
 * должности», переписывался бы при каждом деплое.
 *
 * Запуск: npx tsx prisma/seed-fix-approver-mismatch.ts [--dry-run]
 * На деплое — см. .github/workflows/deploy.yml.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import pg from "pg";

import { decideApproverFix, type PersonDisplayUser } from "../src/lib/approver-display";
import { ORG_ROSTER_WHERE } from "../src/lib/journal-roster";
import {
  SANITATION_DAY_TEMPLATE_CODE,
  buildSanitationDayConfigFromRooms,
} from "../src/lib/sanitation-day-document";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const ONCE_KEY = "once:approver-mismatch:v1";
const DRY_RUN = process.argv.includes("--dry-run");
const TEMPLATE_CODES = [
  SANITATION_DAY_TEMPLATE_CODE,
  "training_plan",
  "audit_plan",
  "equipment_calibration",
  "equipment_maintenance",
];

type ConfigObj = Record<string, unknown>;

function asObj(value: unknown): ConfigObj {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ConfigObj)
    : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function main() {
  const tag = DRY_RUN ? "[approver-fix:dry-run]" : "[approver-fix]";

  const done = await prisma.platformSetting.findUnique({ where: { key: ONCE_KEY } });
  if (done) {
    console.log(`${tag} уже выполнено (${done.value}) — пропускаем`);
    return;
  }

  const templates = await prisma.journalTemplate.findMany({
    where: { code: { in: TEMPLATE_CODES } },
    select: { id: true, code: true },
  });
  const codeByTemplateId = new Map(templates.map((t) => [t.id, t.code] as const));

  const documents = await prisma.journalDocument.findMany({
    where: { status: "active", templateId: { in: templates.map((t) => t.id) } },
    select: {
      id: true,
      title: true,
      organizationId: true,
      buildingId: true,
      templateId: true,
      responsibleUserId: true,
      dateFrom: true,
      config: true,
    },
    orderBy: [{ organizationId: "asc" }, { createdAt: "asc" }],
  });

  const rosterByOrg = new Map<string, PersonDisplayUser[]>();
  async function rosterOf(organizationId: string): Promise<PersonDisplayUser[]> {
    const cached = rosterByOrg.get(organizationId);
    if (cached) return cached;
    const users = await prisma.user.findMany({
      where: { organizationId, ...ORG_ROSTER_WHERE },
      select: {
        id: true,
        name: true,
        role: true,
        positionTitle: true,
        jobPosition: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    });
    rosterByOrg.set(organizationId, users);
    return users;
  }

  let approverFixed = 0;
  let roomsFilled = 0;
  const byRule: Record<string, number> = {};

  for (const document of documents) {
    const code = codeByTemplateId.get(document.templateId) ?? "?";
    const config = asObj(document.config);
    const next: ConfigObj = { ...config };
    const changes: string[] = [];

    const users = await rosterOf(document.organizationId);
    const fix = decideApproverFix({
      config: {
        approveEmployeeId: str(config.approveEmployeeId),
        approveEmployee: str(config.approveEmployee),
        approveRole: str(config.approveRole),
        responsibleEmployeeId: str(config.responsibleEmployeeId),
      },
      documentResponsibleUserId: document.responsibleUserId,
      users,
    });
    if (fix) {
      next.approveEmployeeId = fix.approveEmployeeId;
      next.approveEmployee = fix.approveEmployee;
      next.approveRole = fix.approveRole;
      approverFixed += 1;
      byRule[fix.rule] = (byRule[fix.rule] ?? 0) + 1;
      changes.push(
        `УТВЕРЖДАЮ [${fix.rule}]: «${str(config.approveRole) ?? ""} / ${str(config.approveEmployee) ?? ""}» → «${fix.approveRole} / ${fix.approveEmployee}»`
      );
    }

    if (code === SANITATION_DAY_TEMPLATE_CODE) {
      const rows = Array.isArray(config.rows) ? config.rows : [];
      if (rows.length === 0) {
        // Помещения точки документа; общий документ (без точки) — все
        // помещения организации. Тот же порядок, что у создания.
        const rooms = await prisma.room.findMany({
          where: {
            building: {
              organizationId: document.organizationId,
              ...(document.buildingId ? { id: document.buildingId } : {}),
            },
          },
          select: { id: true, name: true },
          orderBy: [{ buildingId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        });
        if (rooms.length > 0) {
          next.rows = buildSanitationDayConfigFromRooms(rooms, document.dateFrom).rows;
          roomsFilled += 1;
          changes.push(`помещения: 0 → ${rooms.length} (${rooms.map((r) => r.name).join(", ")})`);
        }
      }
    }

    if (changes.length === 0) continue;
    console.log(
      `${tag} ${code} «${document.title}» (${document.id}, org ${document.organizationId}): ${changes.join("; ")}`
    );
    if (DRY_RUN) continue;
    await prisma.journalDocument.update({
      where: { id: document.id },
      data: { config: next as Prisma.InputJsonValue },
    });
  }

  const rules = Object.entries(byRule)
    .map(([rule, count]) => `${rule}: ${count}`)
    .join(", ");
  const summary = `документов: ${documents.length}, шапка исправлена: ${approverFixed}${rules ? ` (${rules})` : ""}, помещения добавлены: ${roomsFilled}`;
  console.log(`${tag} итог — ${summary}`);

  if (!DRY_RUN) {
    await prisma.platformSetting.upsert({
      where: { key: ONCE_KEY },
      create: { key: ONCE_KEY, value: `${new Date().toISOString()} · ${summary}` },
      update: { value: `${new Date().toISOString()} · ${summary}` },
    });
  }
}

main()
  .catch((error) => {
    console.error("[approver-fix] ошибка:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
