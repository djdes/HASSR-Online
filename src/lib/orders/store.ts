/**
 * Реестр изданных приказов: чтение и запись `CompanyOrder`.
 *
 * Все функции принимают `organizationId` явно и фильтруют по нему —
 * приказы бизнес-данные, и multi-tenancy тут такая же обязательная,
 * как у журналов.
 */

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { DOCUMENT_ORG_SELECT } from "@/lib/document-org-block";
import { findOrderTemplate, type OrderTemplate } from "./catalog";
import { buildOrgSnapshot, readOrgSnapshot } from "./org-snapshot";
import type { OrderOrgSnapshot, OrderValues } from "./render";

export class DuplicateOrderNumberError extends Error {
  constructor() {
    super("Приказ с таким номером уже есть в реестре");
    this.name = "DuplicateOrderNumberError";
  }
}

export type StoredOrder = {
  id: string;
  templateCode: string;
  title: string;
  number: string;
  issuedAt: Date;
  values: OrderValues;
  org: OrderOrgSnapshot | null;
  template: OrderTemplate | null;
  createdAt: Date;
};

/** Значения формы из БД: только строковые пары, всё прочее отбрасываем. */
function readValues(json: unknown): OrderValues {
  if (!json || typeof json !== "object") return {};
  const values: OrderValues = {};
  for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
    if (typeof value === "string") values[key] = value;
  }
  return values;
}

function toStored(row: {
  id: string;
  templateCode: string;
  title: string;
  number: string;
  issuedAt: Date;
  values: unknown;
  orgSnapshot: unknown;
  createdAt: Date;
}): StoredOrder {
  return {
    id: row.id,
    templateCode: row.templateCode,
    title: row.title,
    number: row.number,
    issuedAt: row.issuedAt,
    values: readValues(row.values),
    org: readOrgSnapshot(row.orgSnapshot),
    template: findOrderTemplate(row.templateCode),
    createdAt: row.createdAt,
  };
}

/** Реестр организации, свежие сверху. */
export async function listOrders(organizationId: string): Promise<StoredOrder[]> {
  const rows = await db.companyOrder.findMany({
    where: { organizationId },
    orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  return rows.map(toStored);
}

export async function getOrder(
  organizationId: string,
  id: string
): Promise<StoredOrder | null> {
  const row = await db.companyOrder.findFirst({
    where: { id, organizationId },
  });
  return row ? toStored(row) : null;
}

/** Реквизиты организации на сегодня — для новой формы приказа. */
export async function currentOrgSnapshot(
  organizationId: string
): Promise<OrderOrgSnapshot | null> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: DOCUMENT_ORG_SELECT,
  });
  return org ? buildOrgSnapshot(org) : null;
}

export type SaveOrderInput = {
  organizationId: string;
  templateCode: string;
  number: string;
  /** Дата издания как `YYYY-MM-DD` из формы. */
  issuedAt: string;
  values: OrderValues;
  userId: string | null;
};

/**
 * Дата издания из `YYYY-MM-DD` в полдень UTC.
 *
 * Полдень, а не полночь: приказ хранит календарный день, а полночь в
 * UTC при отрисовке в московском поясе показалась бы как 03:00 того же
 * дня, зато в западных поясах — как предыдущий день.
 */
function parseIssuedAt(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return new Date();
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
  );
}

export async function createOrder(input: SaveOrderInput): Promise<StoredOrder> {
  const template = findOrderTemplate(input.templateCode);
  if (!template) throw new Error(`Неизвестный шаблон приказа: ${input.templateCode}`);

  const org = await currentOrgSnapshot(input.organizationId);

  try {
    const row = await db.companyOrder.create({
      data: {
        organizationId: input.organizationId,
        templateCode: template.code,
        title: template.title,
        number: input.number.trim(),
        issuedAt: parseIssuedAt(input.issuedAt),
        values: input.values as Prisma.InputJsonValue,
        orgSnapshot: (org ?? {}) as unknown as Prisma.InputJsonValue,
        createdById: input.userId,
      },
    });
    return toStored(row);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new DuplicateOrderNumberError();
    }
    throw error;
  }
}

export async function updateOrder(
  organizationId: string,
  id: string,
  patch: { number: string; issuedAt: string; values: OrderValues }
): Promise<StoredOrder | null> {
  // Проверяем принадлежность до записи: updateMany молча ничего не
  // сделает, а нам нужно отличить чужой id от успешной правки.
  const existing = await db.companyOrder.findFirst({
    where: { id, organizationId },
    select: { id: true },
  });
  if (!existing) return null;

  try {
    const row = await db.companyOrder.update({
      where: { id },
      data: {
        number: patch.number.trim(),
        issuedAt: parseIssuedAt(patch.issuedAt),
        values: patch.values as Prisma.InputJsonValue,
      },
    });
    return toStored(row);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new DuplicateOrderNumberError();
    }
    throw error;
  }
}

/** Удаление. `false` — приказа нет или он чужой. */
export async function deleteOrder(
  organizationId: string,
  id: string
): Promise<boolean> {
  const removed = await db.companyOrder.deleteMany({
    where: { id, organizationId },
  });
  return removed.count > 0;
}

/**
 * Подсказка следующего номера: максимальный числовой префикс среди
 * изданных плюс один. Человек всё равно правит поле руками, но пустая
 * форма с готовым «13» экономит поход в папку за прошлым приказом.
 */
export function suggestNextNumber(orders: StoredOrder[]): string {
  let max = 0;
  for (const order of orders) {
    const match = /^(\d+)/.exec(order.number.trim());
    if (match) max = Math.max(max, Number(match[1]));
  }
  return String(max + 1);
}
