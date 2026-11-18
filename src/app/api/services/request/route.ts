import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { clientIp } from "@/lib/client-ip";
import { serviceRequestRateLimiter } from "@/lib/rate-limit";
import { readService } from "@/lib/services/catalog";
import { createServiceRequest } from "@/lib/services/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Заявка на платную услугу — из кабинета и с публичной страницы /uslugi.
 *
 * Без авторизации маршрут тоже работает: посетитель сайта должен иметь
 * возможность заказать аудит, не заводя аккаунт. Оплата баллами при этом
 * недоступна — списывать не с чего.
 */

const Schema = z.object({
  serviceKey: z.string().min(1).max(64),
  contactName: z.string().trim().min(2, "Укажите имя").max(120),
  contactPhone: z.string().trim().min(6, "Укажите телефон").max(32),
  contactEmail: z.string().trim().email("Некорректная почта").max(160).optional().or(z.literal("")),
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
  payFromBalance: z.boolean().optional(),
});

export async function POST(request: Request) {
  const ip = clientIp(request) ?? "unknown";
  if (!serviceRequestRateLimiter.consume(`service:${ip}`)) {
    return NextResponse.json(
      { error: "Слишком много заявок. Попробуйте позже или позвоните нам" },
      { status: 429 }
    );
  }

  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные данные" },
      { status: 400 }
    );
  }

  const service = await readService(parsed.data.serviceKey);
  if (!service) {
    return NextResponse.json({ error: "Услуга не найдена" }, { status: 404 });
  }

  const session = await getServerSession(authOptions).catch(() => null);
  let organizationId: string | null = null;
  let organizationName: string | null = null;
  let canSpend = false;

  if (session) {
    organizationId = getActiveOrgId(session);
    canSpend = hasFullWorkspaceAccess(session.user);
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });
    organizationName = org?.name ?? null;
  }

  try {
    const result = await createServiceRequest({
      request,
      service,
      organizationId,
      organizationName,
      userId: session?.user?.id ?? null,
      contactName: parsed.data.contactName,
      contactPhone: parsed.data.contactPhone,
      contactEmail: parsed.data.contactEmail || null,
      comment: parsed.data.comment || null,
      source: session ? "app" : "site",
      payFromBalance: Boolean(parsed.data.payFromBalance),
      canSpend,
    });

    return NextResponse.json({
      id: result.id,
      paidRub: result.paidRub,
      paymentSkippedReason: result.paymentSkippedReason,
    });
  } catch (error) {
    console.error("[services] не удалось создать заявку:", error);
    return NextResponse.json(
      { error: "Не удалось отправить заявку. Попробуйте ещё раз" },
      { status: 500 }
    );
  }
}
