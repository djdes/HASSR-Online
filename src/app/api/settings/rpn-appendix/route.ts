import { NextResponse } from "next/server";
import JSZip from "jszip";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * B9 — Auto-generated appendix для проверки РПН.
 *
 * GET /api/settings/rpn-appendix
 *
 * При проверке РПН инспектор просит набор приложений: список
 * оборудования, список сотрудников с медкнижками, открытые CAPA,
 * audit за период. Менеджер тратит час чтобы это собрать вручную.
 * Теперь — один тап.
 *
 * Возвращает ZIP с 4 CSV-файлами (UTF-8 BOM, ;-разделитель — для
 * Excel/1С compatibility):
 *   - equipment.csv
 *   - staff-with-competencies.csv
 *   - open-capa.csv
 *   - audit-log-30d.csv
 *   - README.txt
 *
 * Auth: management.
 */

// CSV-injection (CWE-1236): equipment.name / user.name / capa.title
// — пользовательский ввод. РПН-инспектор откроет ZIP в Excel; ячейка
// `=cmd|...!A1` исполнится. Префиксим формула-триггеры одинарной
// кавычкой.
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

function csvEscape(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (CSV_FORMULA_PREFIX.test(s)) s = "'" + s;
  if (/[";\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: Array<Record<string, string | number | null>>): string {
  if (rows.length === 0) return "﻿(пусто)";
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvEscape).join(";")];
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h])).join(";"));
  }
  return "﻿" + lines.join("\r\n");
}

export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [equipment, users, competencies, capa, auditLog, org] = await Promise.all(
    [
      db.equipment.findMany({
        where: { area: { organizationId: orgId } },
        include: { area: { select: { name: true } } },
      }),
      db.user.findMany({
        where: { organizationId: orgId, isActive: true, archivedAt: null },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          positionTitle: true,
        },
      }),
      db.staffCompetency.findMany({
        where: { organizationId: orgId },
      }),
      db.capaTicket.findMany({
        where: { organizationId: orgId, status: { not: "closed" } },
      }),
      db.auditLog.findMany({
        where: { organizationId: orgId, createdAt: { gte: since30 } },
        orderBy: { createdAt: "desc" },
        take: 1000,
      }),
      db.organization.findUnique({
        where: { id: orgId },
        select: { name: true, inn: true, address: true },
      }),
    ]
  );

  const competencyByUser = new Map<string, typeof competencies>();
  for (const c of competencies) {
    const list = competencyByUser.get(c.userId) ?? [];
    list.push(c);
    competencyByUser.set(c.userId, list);
  }

  const equipCsv = toCsv(
    equipment.map((e) => ({
      Цех: e.area.name,
      Тип: e.type,
      Название: e.name,
      "Серийный номер": e.serialNumber,
      "t°min": e.tempMin,
      "t°max": e.tempMax,
      Tuya: e.tuyaDeviceId ? "да" : "",
    }))
  );

  const staffCsv = toCsv(
    users.map((u) => {
      const cs = competencyByUser.get(u.id) ?? [];
      return {
        ФИО: u.name,
        Email: u.email,
        Телефон: u.phone,
        Должность: u.positionTitle ?? u.role,
        Компетенции: cs
          .map(
            (c) =>
              `${c.skill}${
                c.expiresAt
                  ? ` (до ${c.expiresAt.toISOString().slice(0, 10)})`
                  : ""
              }`
          )
          .join(" | "),
      };
    })
  );

  const capaCsv = toCsv(
    capa.map((c) => ({
      Дата: c.createdAt.toISOString().slice(0, 10),
      Статус: c.status,
      Приоритет: c.priority,
      Категория: c.category,
      Заголовок: c.title,
      "Корневая причина": c.rootCause ?? "",
      "Корректирующее действие": c.correctiveAction ?? "",
    }))
  );

  const auditCsv = toCsv(
    auditLog.map((a) => ({
      Дата: a.createdAt
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d+Z$/, ""),
      Действие: a.action,
      Сущность: a.entity,
      Кто: a.userName ?? "—",
    }))
  );

  const readme =
    `Приложения для проверки Роспотребнадзора\n` +
    `Дата выгрузки: ${new Date().toLocaleString("ru-RU")}\n\n` +
    `Организация: ${org?.name ?? ""} (ИНН ${org?.inn ?? ""})\n` +
    `Адрес: ${org?.address ?? ""}\n\n` +
    `Содержимое:\n` +
    `- equipment.csv: оборудование с диапазонами температур\n` +
    `- staff-with-competencies.csv: сотрудники + медкнижки/обучение\n` +
    `- open-capa.csv: открытые CAPA-тикеты (расследования нарушений)\n` +
    `- audit-log-30d.csv: журнал действий за 30 дней\n\n` +
    `Все файлы UTF-8 BOM, разделитель «;», открываются в Excel и 1С без настройки.\n`;

  const zip = new JSZip();
  zip.file("equipment.csv", equipCsv);
  zip.file("staff-with-competencies.csv", staffCsv);
  zip.file("open-capa.csv", capaCsv);
  zip.file("audit-log-30d.csv", auditCsv);
  zip.file("README.txt", readme);

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const filename = `rpn-appendix-${new Date()
    .toISOString()
    .slice(0, 10)}.zip`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
