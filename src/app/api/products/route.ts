import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";
import { DEFAULT_PRODUCT_KIND, isProductKind, isServingTemp, shelfLifeFields } from "@/lib/product-kinds";

/**
 * Поля карточки продукта из тела запроса (05.11.2026): вид, срок с единицей
 * (часы или сутки), режим и условие хранения, подача у готовой продукции.
 * Старые клиенты присылают `shelfLifeDays` — это срок в сутках.
 */
function productDetails(
  body: Record<string, unknown>,
  current?: { kind: string; storageConditions: string | null; servingTemp: string | null },
) {
  // Правка без новых полей (старый клиент) не сбрасывает вид, условие и подачу.
  if (current) {
    if (body.kind === undefined) body = { ...body, kind: current.kind };
    if (body.storageConditions === undefined) body = { ...body, storageConditions: current.storageConditions };
    if (body.servingTemp === undefined) body = { ...body, servingTemp: current.servingTemp };
  }
  const kind = body.kind === undefined || body.kind === null || body.kind === "" ? DEFAULT_PRODUCT_KIND : body.kind;
  if (!isProductKind(kind)) return { ok: false as const, error: "Неизвестный вид продукции", errorCode: "PRODUCT_KIND_INVALID" };
  const shelf = body.shelfLifeValue !== undefined
    ? shelfLifeFields(body.shelfLifeValue, body.shelfLifeUnit)
    : shelfLifeFields(body.shelfLifeDays, "days");
  if (!shelf.ok) return { ok: false as const, error: "Срок годности — целое число больше нуля", errorCode: "PRODUCT_SHELF_LIFE_INVALID" };
  const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
  const servingTemp = kind === "finished" && isServingTemp(body.servingTemp) ? body.servingTemp : null;
  return {
    ok: true as const,
    data: {
      kind,
      storageTemp: text(body.storageTemp, 100),
      storageConditions: text(body.storageConditions, 500),
      shelfLifeDays: shelf.shelfLifeDays,
      shelfLifeHours: shelf.shelfLifeHours,
      servingTemp,
    },
  };
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
    }

    const products = await db.product.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        isActive: true,
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(products);
  } catch (error) {
    console.error("Products fetch error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Не авторизован", errorCode: "PRODUCT_UNAUTHORIZED" }, { status: 401 });
    }

    // Раньше: блокировался только legacy "operator". После миграции
    // "cook"/"waiter"/"cleaner" могли создавать/править продукты,
    // хотя UI /settings/products видят только management. Согласовываем
    // с DELETE-эндпоинтом: только management.
    if (!isManagementRole(session.user.role) && !session.user.isRoot) {
      return NextResponse.json({ error: "Это действие доступно руководителю", errorCode: "PRODUCT_MANAGEMENT_REQUIRED" }, { status: 403 });
    }

    const body = await request.json();
    const { name, supplier, barcode, unit, category } = body;

    if (!name || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Название продукта обязательно", errorCode: "PRODUCT_NAME_REQUIRED_CREATE" },
        { status: 400 }
      );
    }
    const details = productDetails(body);
    if (!details.ok) return NextResponse.json({ error: details.error, errorCode: details.errorCode }, { status: 400 });

    // Дубль по названию: в бракераже и приёмке продукт выбирают именно по
    // имени, две одинаковые строки в списке неразличимы.
    // Сравниваем в JS, а не через `mode: "insensitive"`: на кириллице
    // регистронезависимое сравнение зависит от collation базы и «СЫР» не
    // совпадал с «Сыр».
    const existingNames = await db.product.findMany({
      where: { organizationId: getActiveOrgId(session), isActive: true },
      select: { name: true },
    });
    const wanted = name.trim().toLowerCase();
    const duplicate = existingNames.some(
      (item) => item.name.trim().toLowerCase() === wanted
    );
    if (duplicate) {
      return NextResponse.json(
        { error: "Продукт с таким названием уже есть в справочнике", errorCode: "PRODUCT_DUPLICATE_NAME" },
        { status: 400 }
      );
    }

    const product = await db.product.create({
      data: {
        name: name.trim(),
        supplier: supplier?.trim() || null,
        barcode: barcode?.trim() || null,
        unit: unit || "kg",
        category: category?.trim() || null,
        ...details.data,
        organizationId: getActiveOrgId(session),
      },
    });

    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    console.error("Product creation error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", errorCode: "PRODUCT_FAILED" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Не авторизован", errorCode: "PRODUCT_UNAUTHORIZED" }, { status: 401 });
    }

    // Раньше: блокировался только legacy "operator". После миграции
    // "cook"/"waiter"/"cleaner" могли создавать/править продукты,
    // хотя UI /settings/products видят только management. Согласовываем
    // с DELETE-эндпоинтом: только management.
    if (!isManagementRole(session.user.role) && !session.user.isRoot) {
      return NextResponse.json({ error: "Это действие доступно руководителю", errorCode: "PRODUCT_MANAGEMENT_REQUIRED" }, { status: 403 });
    }

    const body = await request.json();
    const { id, name, supplier, barcode, unit, category } = body;

    if (!id) {
      return NextResponse.json({ error: "ID не указан", errorCode: "PRODUCT_ID_REQUIRED" }, { status: 400 });
    }

    const product = await db.product.findFirst({
      where: { id, organizationId: getActiveOrgId(session) },
    });

    if (!product) {
      return NextResponse.json({ error: "Продукт не найден", errorCode: "PRODUCT_NOT_FOUND" }, { status: 404 });
    }

    if (!name || name.trim().length === 0) {
      return NextResponse.json({ error: "Название обязательно", errorCode: "PRODUCT_NAME_REQUIRED_UPDATE" }, { status: 400 });
    }
    const details = productDetails(body, product);
    if (!details.ok) return NextResponse.json({ error: details.error, errorCode: details.errorCode }, { status: 400 });

    const updated = await db.product.update({
      where: { id },
      data: {
        name: name.trim(),
        supplier: supplier?.trim() || null,
        barcode: barcode?.trim() || null,
        unit: unit || "kg",
        category: category?.trim() || null,
        ...details.data,
      },
    });

    return NextResponse.json({ product: updated });
  } catch (error) {
    console.error("Product update error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера", errorCode: "PRODUCT_FAILED" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Не авторизован", errorCode: "PRODUCT_UNAUTHORIZED" }, { status: 401 });
    }

    // head_chef управляет производством и кладовкой — должен мочь
    // удалять/чистить product-каталог наравне с manager'ом. Раньше:
    // только manager → head_chef получал 403. Также добавляем isRoot
    // bypass для согласованности с POST/PUT в этом файле.
    if (!isManagementRole(session.user.role) && !session.user.isRoot) {
      return NextResponse.json({ error: "Это действие доступно руководителю", errorCode: "PRODUCT_MANAGEMENT_REQUIRED" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID не указан", errorCode: "PRODUCT_ID_REQUIRED" }, { status: 400 });
    }

    // Verify product belongs to this organization
    const product = await db.product.findFirst({
      where: { id, organizationId: getActiveOrgId(session) },
    });

    if (!product) {
      return NextResponse.json({ error: "Продукт не найден", errorCode: "PRODUCT_NOT_FOUND" }, { status: 404 });
    }

    await db.product.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Product deletion error:", error);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера", errorCode: "PRODUCT_FAILED" },
      { status: 500 }
    );
  }
}
