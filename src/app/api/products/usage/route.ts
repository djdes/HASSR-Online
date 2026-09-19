import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

/**
 * Где продукт уже используется — чтобы диалог удаления показал число, а не
 * спрашивал «удалить?» вслепую.
 *
 * ПОЧЕМУ по названию: у `Product` нет связи с документами, журналы хранят
 * снимок названия (`productName`, `products: string[]`). Значит и искать
 * приходится по строке.
 */

const PRODUCT_TEMPLATE_CODES = [
  "perishable_rejection",
  "incoming_control",
  "incoming_raw_materials_control",
  "product_writeoff",
];

function collectStrings(value: unknown, sink: Set<string>, depth = 0): void {
  if (depth > 6) return;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed) sink.add(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, sink, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectStrings(item, sink, depth + 1);
    }
  }
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }
    const orgId = getActiveOrgId(session);

    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "ID не указан" }, { status: 400 });
    }

    const product = await db.product.findFirst({
      where: { id, organizationId: orgId },
      select: { name: true },
    });
    if (!product) {
      return NextResponse.json({ error: "Продукт не найден" }, { status: 404 });
    }

    const needle = product.name.trim().toLowerCase();
    const documents = await db.journalDocument.findMany({
      where: {
        organizationId: orgId,
        template: { code: { in: PRODUCT_TEMPLATE_CODES } },
      },
      select: { id: true, config: true },
    });

    const documentCount = documents.filter((doc) => {
      const strings = new Set<string>();
      collectStrings(doc.config, strings);
      return strings.has(needle);
    }).length;

    const bullets: string[] = [];
    if (documentCount > 0) {
      bullets.push(
        `Журналов, где встречается «${product.name}»: ${documentCount}. Заполненные записи останутся, название в них сохранится`
      );
      bullets.push(
        "В списках выбора новых записей продукта больше не будет — заново его придётся заводить вручную"
      );
    } else {
      bullets.push("Продукт пока нигде не используется в журналах");
    }

    return NextResponse.json({ name: product.name, documentCount, bullets });
  } catch (error) {
    console.error("Product usage error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
