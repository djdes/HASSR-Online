import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { readTariffs } from "@/lib/tariffs";
import { parsePlanTariffKey } from "@/lib/tariff-plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/root/tariffs — чтение и правка цен платформы. ROOT-only,
 * middleware отдаёт 404 всем остальным.
 *
 * Правим только цену, название и признак активности: ключ тарифа —
 * это контракт с кнопками оплаты (`/order?plan=standard&cycle=year`) и с
 * уже созданными заказами, поэтому переименовывать его через API нельзя.
 * Срок тарифов 2026-10 задаёт период (30 или 365 дней) — его не правят.
 */

const MIN_PRICE = 1;
const MAX_PRICE = 1_000_000;

export async function GET() {
  await requireRoot();
  const tariffs = await readTariffs();
  return NextResponse.json({ tariffs });
}

export async function PATCH(request: Request) {
  await requireRoot();
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const { key, title, priceRub, periodDays, active } = body as Record<
    string,
    unknown
  >;

  if (typeof key !== "string" || !key) {
    return NextResponse.json({ error: "Не указан тариф" }, { status: 400 });
  }

  const existing = await db.platformTariff.findUnique({ where: { key } });
  if (!existing) {
    return NextResponse.json({ error: "Тариф не найден" }, { status: 404 });
  }

  const data: {
    title?: string;
    priceRub?: number;
    periodDays?: number;
    active?: boolean;
  } = {};

  if (title !== undefined) {
    if (typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json(
        { error: "Название не может быть пустым" },
        { status: 400 },
      );
    }
    data.title = title.trim().slice(0, 120);
  }

  if (priceRub !== undefined) {
    const price = Number(priceRub);
    if (!Number.isInteger(price) || price < MIN_PRICE || price > MAX_PRICE) {
      return NextResponse.json(
        { error: `Цена должна быть целым числом от ${MIN_PRICE} до ${MAX_PRICE} ₽` },
        { status: 400 },
      );
    }
    data.priceRub = price;
  }

  // Срок тарифа 2026-10 задаёт период (`CYCLE_DAYS`), его считает и оплата.
  if (periodDays !== undefined && parsePlanTariffKey(key) && Number(periodDays) !== existing.periodDays) {
    return NextResponse.json(
      { error: "Срок тарифа «Стандарт»/«Премиум» задаёт период — месяц или год" },
      { status: 400 },
    );
  }
  if (periodDays !== undefined) {
    const days = Number(periodDays);
    if (!Number.isInteger(days) || days < 1 || days > 366) {
      return NextResponse.json(
        { error: "Период должен быть от 1 до 366 дней" },
        { status: 400 },
      );
    }
    data.periodDays = days;
  }

  if (active !== undefined) {
    if (typeof active !== "boolean") {
      return NextResponse.json(
        { error: "Некорректный признак активности" },
        { status: 400 },
      );
    }
    data.active = active;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Нечего менять" }, { status: 400 });
  }

  const tariff = await db.platformTariff.update({ where: { key }, data });
  return NextResponse.json({ tariff });
}
