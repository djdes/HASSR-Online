import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import { buildLosses1cCsv } from "@/lib/losses-1c-export";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/losses-export-1c?secret=$CRON_SECRET
 *
 * Раз в неделю (рекомендуется понедельник 09:00 MSK) для каждой
 * организации с заполненным `accountantEmail` собирает LossRecord
 * за прошедшую неделю в CSV (UTF-8 BOM, разделитель ";") и шлёт
 * на этот email с attachment'ом.
 *
 * Формат — простой реестр для импорта в 1С:Бухгалтерия через
 * «Загрузка данных из табличного документа». Если рестораторы
 * попросят полноценный CommerceML 2.x XML — добавим следом.
 *
 * INFRA NEXT: настроить внешний cron на `cron-job.org` каждый
 * понедельник 06:00 UTC = 09:00 MSK.
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const orgs = await db.organization.findMany({
    where: { accountantEmail: { not: null }, ...NOT_DIRECTORY_ORG_WHERE },
    select: {
      id: true,
      name: true,
      inn: true,
      accountantEmail: true,
    },
  });

  if (orgs.length === 0) {
    return NextResponse.json({ ok: true, organizationsProcessed: 0 });
  }

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  weekStart.setUTCHours(0, 0, 0, 0);
  const weekEnd = new Date(now);
  weekEnd.setUTCHours(0, 0, 0, 0);

  const smtpHost = (process.env.SMTP_HOST ?? "").trim();
  const smtpConfigured = smtpHost.length > 0 && smtpHost !== "localhost";

  const transporter = smtpConfigured
    ? nodemailer.createTransport({
        host: smtpHost,
        port: Number(process.env.SMTP_PORT) || 25,
        secure: false,
        tls: { rejectUnauthorized: smtpHost !== "localhost" },
        connectionTimeout: 5000,
        socketTimeout: 5000,
      })
    : null;

  const FROM = process.env.SMTP_FROM || "WeSetup <noreply@wesetup.ru>";
  const results: Array<{
    organizationId: string;
    rows: number;
    totalSumRub: number;
    sent: boolean;
    skipReason?: string;
  }> = [];

  for (const org of orgs) {
    if (!org.accountantEmail) continue;
    const { csv, rowCount, totalSumKopecks } = await buildLosses1cCsv(
      org.id,
      weekStart,
      weekEnd
    );

    if (rowCount === 0) {
      results.push({
        organizationId: org.id,
        rows: 0,
        totalSumRub: 0,
        sent: false,
        skipReason: "no-records",
      });
      continue;
    }

    const filename = `losses-${org.id}-${weekStart
      .toISOString()
      .slice(0, 10)}.csv`;
    const totalSumRub = totalSumKopecks / 100;

    if (!transporter) {
      console.info(
        `[1c-export/dev] SMTP не настроен — письмо не отправлено на ${org.accountantEmail}`
      );
      results.push({
        organizationId: org.id,
        rows: rowCount,
        totalSumRub,
        sent: false,
        skipReason: "smtp-not-configured",
      });
      continue;
    }

    try {
      await transporter.sendMail({
        from: FROM,
        to: org.accountantEmail,
        subject: `Списания за неделю: ${org.name} (${rowCount} записей)`,
        text:
          `Здравствуйте,\n\n` +
          `во вложении — CSV-файл со списаниями за период ${weekStart
            .toISOString()
            .slice(0, 10)} — ${weekEnd
            .toISOString()
            .slice(0, 10)}.\n\n` +
          `Организация: ${org.name}${org.inn ? ` (ИНН ${org.inn})` : ""}\n` +
          `Записей: ${rowCount}\n` +
          `Сумма списаний: ${totalSumRub.toFixed(2)} ₽\n\n` +
          `Файл в кодировке UTF-8 с BOM, разделитель — точка с запятой. ` +
          `Открывается в Excel и импортируется в 1С:Бухгалтерия через ` +
          `«Загрузка данных из табличного документа».\n\n` +
          `Это автоматическое письмо от WeSetup. На вопросы по ` +
          `выгрузке отвечайте администратору организации.`,
        attachments: [
          {
            filename,
            content: csv,
            contentType: "text/csv; charset=utf-8",
          },
        ],
      });
      await db.auditLog.create({
        data: {
          organizationId: org.id,
          action: "1c_losses_export.sent",
          entity: "losses_export",
          details: {
            recipient: org.accountantEmail,
            rows: rowCount,
            totalSumRub,
            periodFrom: weekStart.toISOString(),
            periodTo: weekEnd.toISOString(),
          },
        },
      });
      results.push({
        organizationId: org.id,
        rows: rowCount,
        totalSumRub,
        sent: true,
      });
    } catch (err) {
      console.error("[1c-export] send failed", err);
      results.push({
        organizationId: org.id,
        rows: rowCount,
        totalSumRub,
        sent: false,
        skipReason: err instanceof Error ? err.message : "send-error",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    organizationsProcessed: orgs.length,
    sent: results.filter((r) => r.sent).length,
    results,
  });
}

export const GET = handle;
export const POST = handle;
