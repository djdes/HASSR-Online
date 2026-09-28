import { NextResponse } from "next/server";
import { jsPDF } from "jspdf";
import { enqueueAndWait } from "@/lib/ai-assistant/pf-client";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { aiHeavyRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * B7 — AI-генератор ХАССП-плана PDF под профиль организации.
 *
 * GET /api/ai/haccp-plan
 *
 * Собирает контекст org (тип, оборудование, штат, активные журналы)
 * → диспетчер ProjectsFlow (src/lib/ai-assistant/pf-client.ts) → markdown → jsPDF → A4 PDF.
 *
 * При первой проверке РПН инспектор просит «дайте ваш ХАССП-план».
 * Менеджер обычно ищет в Google docs шаблон и адаптирует. Теперь —
 * 30 сек и готовый draft.
 *
 * Auth: management. Если интеграция с диспетчером не настроена → 503.
 */

const SYSTEM_PROMPT = `Ты — технолог-консультант с 20-летним опытом внедрения ХАССП в российских пищевых компаниях. Твоя задача — написать draft-ХАССП-плана под профиль конкретной организации.

Структура плана (раздел = #, подраздел = ##):

# ХАССП-план для организации [Название]

## 1. Описание организации и продукции
Тип, ассортимент, целевые потребители, объём.

## 2. Команда ХАССП
Кто отвечает: роль и пустое поле «ФИО: ____________» — имён сотрудников у тебя нет, их впишет руководитель. Минимум 3 человека: руководитель, технолог, представитель производства.

## 3. Технологическая карта производства
Этапы от приёмки сырья до подачи. Кратко.

## 4. Анализ опасностей
Биологические / химические / физические риски. По каждой группе — где возникает.

## 5. Критические контрольные точки (CCP)
3-5 точек. Для каждой:
- Шаг
- Опасность
- Критический предел (с цифрами)
- Метод мониторинга
- Корректирующее действие

## 6. Ведение записей
Какие журналы вести, кто, когда.

## 7. Верификация и пересмотр
Раз в год — пересмотр плана. Внутренний аудит.

Стиль: конкретный, с цифрами и ссылками на ГОСТ/СанПиН. План — рабочий документ технолога: в каждом разделе только то, что он применит на этом предприятии.

Возвращай чистый markdown без артефактов и без объяснений вокруг.`;

export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  if (!aiHeavyRateLimiter.consume(`ai-haccp:${auth.session.user.id}`)) {
    return NextResponse.json(
      { error: "Слишком много запросов" },
      { status: 429 }
    );
  }

  const orgId = getActiveOrgId(auth.session);
  const [org, userCount, equipmentCount, templates] = await Promise.all([
    db.organization.findUnique({
      where: { id: orgId },
      select: { name: true, type: true, address: true, inn: true },
    }),
    db.user.count({
      where: { organizationId: orgId, isActive: true, archivedAt: null },
    }),
    db.equipment.count({ where: { area: { organizationId: orgId } } }),
    db.journalDocument.findMany({
      where: { organizationId: orgId, status: "active" },
      select: { template: { select: { code: true, name: true } } },
      take: 50,
    }),
  ]);

  const userPrompt =
    `Профиль организации:\n` +
    `- Название: ${org?.name ?? "—"}\n` +
    `- Тип: ${org?.type ?? "—"}\n` +
    `- ИНН: ${org?.inn ?? "—"}\n` +
    `- Адрес: ${org?.address ?? "—"}\n` +
    `- Активных сотрудников: ${userCount}\n` +
    `- Единиц оборудования: ${equipmentCount}\n` +
    `- Активные журналы: ${templates
      .map((t) => t.template.name)
      .join(", ")}\n\n` +
    `Сгенерируй полный ХАССП-план в markdown.`;

  // AI-запрос уходит в очередь диспетчера ProjectsFlow — сайт к LLM не
  // ходит (см. src/lib/ai-assistant/pf-client.ts).
  const result = await enqueueAndWait(
    ["type: wesetup_haccp_plan", "---", SYSTEM_PROMPT, "---", userPrompt].join(
      "\n"
    )
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.code === "not_configured" ? 503 : 502 }
    );
  }
  const markdown = result.text.trim();
  if (!markdown) {
    return NextResponse.json(
      { error: "AI вернул пустой ответ" },
      { status: 502 }
    );
  }

  // Render markdown → PDF (простой подход: каждую line печатаем).
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFontSize(10);
  let y = 20;
  const lineHeight = 5;
  const maxWidth = 170;
  const pageHeight = 280;

  const lines = markdown.split("\n");
  for (const line of lines) {
    if (y > pageHeight) {
      doc.addPage();
      y = 20;
    }
    if (line.startsWith("# ")) {
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      const wrapped = doc.splitTextToSize(line.slice(2), maxWidth);
      doc.text(wrapped as string[], 20, y);
      y += wrapped.length * 7;
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      y += 2;
    } else if (line.startsWith("## ")) {
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      const wrapped = doc.splitTextToSize(line.slice(3), maxWidth);
      doc.text(wrapped as string[], 20, y);
      y += wrapped.length * 6;
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      y += 1;
    } else if (line.trim() === "") {
      y += lineHeight / 2;
    } else {
      const stripped = line.replace(/[*_`]/g, "");
      const wrapped = doc.splitTextToSize(stripped, maxWidth);
      doc.text(wrapped as string[], 20, y);
      y += wrapped.length * lineHeight;
    }
  }

  const buffer = Buffer.from(doc.output("arraybuffer"));
  const filename = `haccp-plan-${orgId.slice(0, 8)}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
