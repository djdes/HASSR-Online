import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { COMPANY_ONLY_API_ERROR, isPointScoped } from "@/lib/point-scope";
import { isOrderTemplateCode } from "@/lib/orders/catalog";
import {
  createOrder,
  deleteOrder,
  DuplicateOrderNumberError,
  updateOrder,
} from "@/lib/orders/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Реестр изданных приказов.
 *
 * Приказ — распорядительный документ организации: заводить и удалять
 * его может только руководство, как и менять тариф. Рядовой сотрудник
 * приказы видит (они висят на стене), но не издаёт.
 */

const ValuesSchema = z.record(z.string(), z.string().max(2000));

const CreateSchema = z.object({
  templateCode: z.string().min(1).max(64),
  number: z.string().trim().min(1, "Укажите номер приказа").max(32),
  issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Некорректная дата"),
  values: ValuesSchema,
});

const UpdateSchema = z.object({
  id: z.string().min(1).max(64),
  number: z.string().trim().min(1, "Укажите номер приказа").max(32),
  issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Некорректная дата"),
  values: ValuesSchema,
});

async function requireManagement() {
  const auth = await requireApiAuth();
  if (!auth.ok) return { ok: false as const, response: auth.response };

  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Приказы издаёт руководитель организации" },
        { status: 403 }
      ),
    };
  }
  // Приказы — документы компании: руководителю точки закрыты (2026-11-01).
  if (isPointScoped(auth.session.user)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: COMPANY_ONLY_API_ERROR }, { status: 403 }),
    };
  }
  return { ok: true as const, session: auth.session };
}

export async function POST(request: Request) {
  const auth = await requireManagement();
  if (!auth.ok) return auth.response;

  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные данные" },
      { status: 400 }
    );
  }

  if (!isOrderTemplateCode(parsed.data.templateCode)) {
    return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 });
  }

  try {
    const order = await createOrder({
      organizationId: getActiveOrgId(auth.session),
      templateCode: parsed.data.templateCode,
      number: parsed.data.number,
      issuedAt: parsed.data.issuedAt,
      values: parsed.data.values,
      userId: auth.session.user.id ?? null,
    });
    return NextResponse.json({ id: order.id });
  } catch (error) {
    if (error instanceof DuplicateOrderNumberError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[orders] не удалось сохранить приказ:", error);
    return NextResponse.json({ error: "Не удалось сохранить" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireManagement();
  if (!auth.ok) return auth.response;

  const parsed = UpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные данные" },
      { status: 400 }
    );
  }

  try {
    const order = await updateOrder(
      getActiveOrgId(auth.session),
      parsed.data.id,
      {
        number: parsed.data.number,
        issuedAt: parsed.data.issuedAt,
        values: parsed.data.values,
      }
    );
    if (!order) {
      return NextResponse.json({ error: "Приказ не найден" }, { status: 404 });
    }
    return NextResponse.json({ id: order.id });
  } catch (error) {
    if (error instanceof DuplicateOrderNumberError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[orders] не удалось обновить приказ:", error);
    return NextResponse.json({ error: "Не удалось сохранить" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireManagement();
  if (!auth.ok) return auth.response;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Не указан приказ" }, { status: 400 });
  }

  const removed = await deleteOrder(getActiveOrgId(auth.session), id);
  if (!removed) {
    return NextResponse.json({ error: "Приказ не найден" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
