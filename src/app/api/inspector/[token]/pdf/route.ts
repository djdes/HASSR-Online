import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { resolveOrgJournalName } from "@/lib/org-journal-name";
import { buildOrgSnapshot } from "@/lib/orders/org-snapshot";
import { registerJournalUnicodeFont } from "@/lib/pdf-journal-font";
import {
  inspectorClientIp,
  inspectorLimitKey,
  inspectorPdfLimiter,
  inspectorViewerCookie,
  loadInspectorAccess,
  logInspectorEvent,
  readInspectorViewer,
} from "@/lib/inspector-access";
import { loadInspectorJournals } from "@/lib/inspector-journals";
import { formatDayKeyRu, inspectorControlCode, resolveInspectorPeriod } from "@/lib/inspector-qr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Сводный PDF для проверяющего за выбранный период (`?p=&from=&to=`,
 * зажимается окном токена): реквизиты, таблица журналов по группам
 * «СанПиН / ХАССП / прочие» с числом документов и записей, электронная
 * отметка с контрольным кодом.
 *
 * Шрифт — тот же, что у печатных журналов (`registerJournalUnicodeFont`,
 * Liberation Serif): штатная Helvetica jsPDF кириллицы не знает, раньше
 * русский текст печатался кракозябрами.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  const access = await loadInspectorAccess(token);
  if (access.status === "not_found") return new Response("Не найдено", { status: 404 });
  if (access.status !== "ok") return new Response("Доступ отозван или истёк", { status: 410 });
  const key = inspectorLimitKey(access.token.id, inspectorClientIp(request.headers));
  if (!inspectorPdfLimiter.consume(key)) {
    return new Response("Слишком много запросов. Повторите через минуту.", { status: 429 });
  }

  const url = new URL(request.url);
  const period = resolveInspectorPeriod({
    window: access.window,
    today: access.today,
    preset: url.searchParams.get("p") ?? (access.isQr ? null : "custom"),
    from: url.searchParams.get("from") ?? (access.isQr ? null : access.window.from),
    to: url.searchParams.get("to") ?? (access.isQr ? null : access.window.to),
  });
  const groups = await loadInspectorJournals(access, period.from, period.to);
  const snapshot = buildOrgSnapshot({
    name: access.org.name,
    inn: access.org.inn,
    address: access.org.address,
    legalProfileJson: access.org.legalProfileJson,
  });
  const orgTitle = resolveOrgJournalName(access.org);
  const generatedAt = new Date();
  const generatedText = generatedAt.toLocaleString("ru-RU", { timeZone: access.org.timezone || "Europe/Moscow" });
  const periodText = `${formatDayKeyRu(period.from)} - ${formatDayKeyRu(period.to)}`;

  const rowsFlat = groups.flatMap((g) => g.rows);
  const controlCode = inspectorControlCode([
    access.org.id,
    period.from,
    period.to,
    ...rowsFlat.map((r) => `${r.code}:${r.docCount}:${r.entryCount}`),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const font = registerJournalUnicodeFont(doc);
  doc.setFont(font, "normal");
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text("СВОДКА ЖУРНАЛОВ ПРОИЗВОДСТВЕННОГО КОНТРОЛЯ", 20, 18);
  doc.setDrawColor(40);
  doc.setLineWidth(0.4);
  doc.line(20, 21, pageW - 20, 21);

  doc.setTextColor(20);
  doc.setFontSize(16);
  doc.text(doc.splitTextToSize(orgTitle, pageW - 40), 20, 31);
  doc.setFontSize(10);
  doc.setTextColor(60);
  let y = 40;
  const requisites = [
    snapshot.orgName !== orgTitle ? snapshot.orgName : null,
    snapshot.orgInn ? `ИНН ${snapshot.orgInn}` : null,
    snapshot.orgAddress ? `Адрес: ${snapshot.orgAddress}` : null,
    snapshot.directorName ? `${snapshot.directorPost ?? "Руководитель"}: ${snapshot.directorName}` : null,
  ].filter((v): v is string => Boolean(v));
  for (const line of requisites) {
    const wrapped = doc.splitTextToSize(line, pageW - 40);
    doc.text(wrapped, 20, y);
    y += 5 * wrapped.length;
  }
  y += 2;
  doc.setTextColor(20);
  doc.text(`Период: ${periodText}`, 20, y);
  doc.text(`Сформировано: ${generatedText}`, pageW - 20, y, { align: "right" });
  y += 6;

  const body: string[][] = [];
  for (const g of groups) {
    body.push([g.label, "", ""]);
    for (const r of g.rows) {
      body.push([r.name, String(r.docCount), r.entryCount === 0 ? "нет записей" : String(r.entryCount)]);
    }
  }
  const groupLabels = new Set(groups.map((g) => g.label));

  autoTable(doc, {
    startY: y,
    margin: { left: 20, right: 20 },
    head: [["Журнал", "Документов", "Записей за период"]],
    body,
    theme: "grid",
    styles: { font, fontStyle: "normal", fontSize: 9, cellPadding: 1.8, lineColor: [60, 60, 60], lineWidth: 0.15, textColor: [20, 20, 20] },
    headStyles: { font, fontStyle: "normal", fillColor: [236, 236, 236], textColor: [20, 20, 20] },
    columnStyles: {
      0: { cellWidth: 110 },
      1: { halign: "right" },
      2: { halign: "right" },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 0 && groupLabels.has(String(data.cell.raw))) {
        data.cell.colSpan = 3;
        data.cell.styles.fillColor = [248, 248, 248];
        data.cell.styles.textColor = [80, 80, 80];
      }
    },
  });

  // Электронная отметка — не печать организации, а визуализация того,
  // что документ собран системой, с кодом для сверки. Чёрная: синие
  // «чернила» на ч/б принтере выходили тёмно-серыми, отметку и так
  // выделяют рамка и заголовок.
  const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 20;
  let stampY = lastY + 10;
  if (stampY > 245) {
    doc.addPage();
    stampY = 20;
  }
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.rect(20, stampY, 110, 30);
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(8.5);
  doc.text("ДОКУМЕНТ СФОРМИРОВАН В ЭЛЕКТРОННОМ ВИДЕ", 24, stampY + 6);
  doc.setFontSize(8);
  doc.text(doc.splitTextToSize(`Организация: ${snapshot.orgShortName}${snapshot.orgInn ? `, ИНН ${snapshot.orgInn}` : ""}`, 102), 24, stampY + 12);
  doc.text(`Период: ${periodText}`, 24, stampY + 20);
  doc.text(`Сформировано: ${generatedText}`, 24, stampY + 24);
  doc.text(`Контрольный код: ${controlCode}`, 24, stampY + 28);

  doc.setTextColor(120);
  doc.setFontSize(7.5);
  doc.text(
    doc.splitTextToSize(
      "Журналы ведутся в электронном виде в системе WeSetup. Записи подписываются сотрудниками (личный PIN или вход), время фиксируется автоматически. Отметка системы не является печатью организации.",
      pageW - 40
    ),
    20,
    285 - 8
  );

  const viewer = readInspectorViewer(
    request.headers.get("cookie")?.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${inspectorViewerCookie(access.token.id)}=`))?.split("=").slice(1).join("=")
  );
  await logInspectorEvent({
    access,
    headers: request.headers,
    action: "inspector.download",
    viewer,
    details: { kind: "summary_pdf", from: period.from, to: period.to, controlCode },
  });

  const buffer = new Uint8Array(doc.output("arraybuffer"));
  const filename = `svodka-zhurnalov-${period.from}-${period.to}.pdf`;
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
