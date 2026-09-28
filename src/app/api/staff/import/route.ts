import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import crypto from "node:crypto";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";
import { normalizePhone } from "@/lib/phone";
import { recordAuditLog } from "@/lib/audit-log";
import { ensurePlanForHeadcount } from "@/lib/plan-limits.server";
import { seatAllowance, seatLimitSummary } from "@/lib/billing.server";
import { FREE_LIMIT_MESSAGE } from "@/lib/billing-period";
import { tryAutolinkTasksflowByPhone } from "@/lib/tasksflow-autolink";
import { DEFAULT_WEEKLY_DAYS_OFF } from "@/lib/staff-days-off";
import { STAFF_SHEET_NAME, parseStaffSheet } from "@/lib/staff-excel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Файл разбирается в памяти — потолок ставим до чтения, а не после. */
const MAX_BYTES = 5 * 1024 * 1024;
/** Больше сотни строк за раз — это уже не «завёл команду», а миграция. */
const MAX_ROWS = 500;

function syntheticEmail(orgId: string) {
  const salt = crypto.randomBytes(6).toString("hex");
  return `staff-${salt}@${orgId}.local.haccp`;
}

/**
 * POST /api/staff/import — загрузка сотрудников из Excel.
 *
 * multipart/form-data: `file` — .xlsx, `mode` — "skip" | "update".
 *
 * Повторная загрузка того же файла безопасна: совпавшие люди уходят в
 * `skipped`, а не задваиваются. Совпадение ищем по телефону, а при его
 * отсутствии — по паре ФИО + должность.
 */
export async function POST(request: Request) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(session);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const mode = String(form?.get("mode") ?? "skip") === "update" ? "update" : "skip";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Файл не приложен" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Файл больше 5 МБ — разбейте его на части" },
      { status: 413 }
    );
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    return NextResponse.json(
      { error: "Не удалось прочитать файл. Нужен .xlsx" },
      { status: 400 }
    );
  }

  const sheet =
    workbook.getWorksheet(STAFF_SHEET_NAME) ?? workbook.worksheets[0];
  if (!sheet) {
    return NextResponse.json({ error: "В файле нет листов" }, { status: 400 });
  }

  const raw: unknown[][] = [];
  sheet.eachRow((row) => {
    const values = row.values as unknown[];
    // ExcelJS отдаёт values с единицы — нулевой элемент всегда пустой.
    raw.push(values.slice(1));
  });

  const parsed = parseStaffSheet(raw);
  const errors = [...parsed.errors];
  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: errors[0]?.message ?? "В файле нет строк с сотрудниками", errors },
      { status: 400 }
    );
  }
  if (parsed.rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Больше ${MAX_ROWS} строк за раз — разбейте файл` },
      { status: 400 }
    );
  }

  const [positions, templates, positionAccess] = await Promise.all([
    db.jobPosition.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, categoryKey: true },
    }),
    db.journalTemplate.findMany({ select: { code: true, name: true } }),
    db.jobPositionJournalAccess.findMany({
      where: { organizationId: orgId },
      include: { template: { select: { code: true } } },
    }),
  ]);

  const positionByName = new Map(
    positions.map((item) => [item.name.toLowerCase(), item])
  );
  const codeByJournalName = new Map(
    templates.map((item) => [item.name.toLowerCase(), item.code])
  );
  // Файлы, выгруженные до переименования (2026-09-22), ещё содержат
  // старое название гигиенического журнала.
  if (!codeByJournalName.has("гигиенический журнал")) {
    codeByJournalName.set("гигиенический журнал", "hygiene");
  }
  const codesByPosition = new Map<string, string[]>();
  for (const item of positionAccess) {
    const list = codesByPosition.get(item.jobPositionId) ?? [];
    list.push(item.template.code);
    codesByPosition.set(item.jobPositionId, list);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  // Лимит тарифа — по строкам ДО создания каждой (комиссия не считается).
  let seatsLeft = (await seatAllowance(orgId)).left;
  let seatBlocked = 0;

  for (const row of parsed.rows) {
    const position = positionByName.get(row.positionName.toLowerCase());
    if (!position) {
      errors.push({
        line: row.line,
        message: `Должность «${row.positionName}» не найдена. Создайте её в настройках или исправьте название.`,
      });
      continue;
    }

    const rawPhone = row.phone.trim();
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    if (rawPhone && !phone) {
      errors.push({
        line: row.line,
        message: `«${row.fullName}»: не разобрал телефон «${rawPhone}»`,
      });
      continue;
    }

    // Явно перечисленные журналы превращаем в коды; неизвестное название
    // — ошибка строки, а не молчаливая потеря доступа.
    let explicitCodes: string[] | null = null;
    if (row.journalNames) {
      const codes: string[] = [];
      const unknown: string[] = [];
      for (const name of row.journalNames) {
        const code = codeByJournalName.get(name.toLowerCase());
        if (code) codes.push(code);
        else unknown.push(name);
      }
      if (unknown.length > 0) {
        errors.push({
          line: row.line,
          message: `«${row.fullName}»: не знаю журнал ${unknown
            .map((name) => `«${name}»`)
            .join(", ")}`,
        });
        continue;
      }
      explicitCodes = codes;
    }

    const existing = await db.user.findFirst({
      where: phone
        ? { organizationId: orgId, phone }
        : {
            organizationId: orgId,
            name: row.fullName,
            jobPositionId: position.id,
          },
      select: { id: true },
    });

    if (existing) {
      if (mode !== "update") {
        skipped += 1;
        continue;
      }
      // Обновляем только то, что человек реально мог поменять в файле.
      // ФИО и должность не трогаем: их правка через файл слишком легко
      // превращается в подмену не того сотрудника.
      await db.user.update({
        where: { id: existing.id },
        data: {
          phone: phone ?? undefined,
          contactEmail: row.contactEmail.trim() || undefined,
          weeklyDaysOff: row.weeklyDaysOff,
        },
      });
      if (explicitCodes) {
        await db.$transaction([
          db.userJournalAccess.deleteMany({ where: { userId: existing.id } }),
          db.userJournalAccess.createMany({
            data: explicitCodes.map((templateCode) => ({
              userId: existing.id,
              templateCode,
              canRead: true,
              canWrite: true,
              canFinalize: false,
            })),
            skipDuplicates: true,
          }),
          db.user.update({
            where: { id: existing.id },
            data: { journalAccessMigrated: true },
          }),
        ]);
      }
      updated += 1;
      continue;
    }

    if (position.categoryKey !== "commission") {
      if (seatsLeft <= 0) {
        errors.push({ line: row.line, message: `«${row.fullName}»: ${FREE_LIMIT_MESSAGE}` });
        seatBlocked += 1;
        continue;
      }
      seatsLeft -= 1;
    }

    const inherited = codesByPosition.get(position.id) ?? [];
    const codes = explicitCodes ?? inherited;
    const strictAcl = explicitCodes !== null || inherited.length > 0;

    const user = await db.$transaction(async (tx) => {
      const record = await tx.user.create({
        data: {
          organizationId: orgId,
          name: row.fullName,
          email: syntheticEmail(orgId),
          passwordHash: "",
          role: position.categoryKey === "management" ? "manager" : "cook",
          phone,
          contactEmail: row.contactEmail.trim() || null,
          weeklyDaysOff:
            row.weeklyDaysOff.length > 0
              ? row.weeklyDaysOff
              : [...DEFAULT_WEEKLY_DAYS_OFF],
          jobPositionId: position.id,
          positionTitle: position.name,
          isActive: true,
          journalAccessMigrated: strictAcl,
        },
        select: { id: true, name: true },
      });
      if (strictAcl && codes.length > 0) {
        await tx.userJournalAccess.createMany({
          data: codes.map((templateCode) => ({
            userId: record.id,
            templateCode,
            canRead: true,
            canWrite: true,
            canFinalize: false,
          })),
          skipDuplicates: true,
        });
      }
      return record;
    });

    created += 1;
    if (phone) {
      tryAutolinkTasksflowByPhone({
        organizationId: orgId,
        weSetupUserId: user.id,
        phone,
        name: user.name,
      }).catch((error) => console.error("[staff-import] autolink failed", error));
    }
  }

  const planCheck = await ensurePlanForHeadcount(orgId);
  const billingLimit = seatLimitSummary(seatBlocked, "staff.import", orgId);

  await recordAuditLog({
    request,
    session,
    organizationId: orgId,
    action: "staff.excel-import",
    entity: "User",
    entityId: null,
    details: {
      mode,
      attempted: parsed.rows.length,
      created,
      updated,
      skipped,
      errorCount: errors.length,
    },
  });

  return NextResponse.json({
    ok: true,
    created,
    updated,
    skipped,
    errors,
    planUpgraded: planCheck.upgraded,
    billingLimit,
  });
}
