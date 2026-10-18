import { NextResponse } from "next/server";

import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { clientIp } from "@/lib/client-ip";
import { journalSampleRateLimiter } from "@/lib/rate-limit";
import { loadDocumentOrgBlock } from "@/lib/document-org-block.server";
import { toOrderOrgSnapshot } from "@/lib/document-org-block";
import { findOrderTemplate } from "@/lib/orders/catalog";
import { renderOrderPdf } from "@/lib/orders/pdf";
import { defaultOrderValues, type OrderOrgSnapshot } from "@/lib/orders/render";
import type { PdfLogo } from "@/lib/pdf-logo";
import { loadPdfOrgLogo } from "@/lib/pdf-logo.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PDF приказа.
 *
 * Работает и без сессии — это витрина /prikazy: человек должен увидеть
 * готовый бланк до регистрации. Разница только в реквизитах: гостю
 * печатаем пустой бланк с прочерками, залогиненному подставляем данные
 * его организации.
 *
 * Код шаблона проверяется по белому списку каталога, иначе в рендер
 * прилетал бы произвольный сегмент URL.
 */

/** Пустой бланк: всё прочерками, человек дописывает ручкой. */
const BLANK_ORG: OrderOrgSnapshot = {
  orgName: "",
  orgShortName: "",
  orgInn: null,
  orgAddress: null,
  directorName: null,
  directorPost: null,
  city: null,
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const template = findOrderTemplate(code);
  if (!template) {
    return NextResponse.json({ error: "Приказ не найден" }, { status: 404 });
  }

  const ip = clientIp(request) ?? "unknown";
  if (!journalSampleRateLimiter.consume(`order-pdf:${ip}`)) {
    return NextResponse.json(
      { error: "Слишком много запросов. Попробуйте через минуту" },
      { status: 429 }
    );
  }

  const url = new URL(request.url);
  const session = await getServerSession(authOptions).catch(() => null);

  // Залогиненному — реквизиты, логотип и фирменный цвет его организации.
  let org = BLANK_ORG;
  let logo: PdfLogo | null = null;
  let brandColor: string | null = null;
  if (session) {
    const organizationId = getActiveOrgId(session);
    const block = await loadDocumentOrgBlock(organizationId);
    if (block) {
      org = toOrderOrgSnapshot(block);
      logo = await loadPdfOrgLogo(organizationId, block.brand.logoUrl);
      brandColor = block.brand.color;
    }
  }

  try {
    const { buffer, fileName } = renderOrderPdf({
      template,
      org,
      // Пустой бланк: значения не подставляем даже залогиненному —
      // заполненный приказ печатается из формы, а не из этой ссылки.
      values: Object.fromEntries(
        Object.keys(defaultOrderValues(template)).map((key) => [key, ""])
      ),
      number: "",
      issuedAt: "",
      logo,
      brandColor,
    });

    const disposition = url.searchParams.get("inline") === "1" ? "inline" : "attachment";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[orders] не удалось собрать PDF:", error);
    return NextResponse.json({ error: "Не удалось собрать PDF" }, { status: 500 });
  }
}
