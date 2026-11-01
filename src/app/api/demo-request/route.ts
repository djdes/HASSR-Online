import { NextResponse } from "next/server";
import { z } from "zod";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import {
  DEMO_SERVICE_KEY,
  DEMO_SERVICE_TITLE,
  DEMO_WHEN,
  composeDemoAlert,
  composeDemoComment,
  hasEnoughPhoneDigits,
  type DemoRequest,
} from "@/lib/demo-request";
import { sendRawEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";
import { getPlatformAdminEmail, notifyPlatformAdmin } from "@/lib/platform-admin";
import { demoRequestRateLimiter } from "@/lib/rate-limit";
import { getServerSession } from "@/lib/server-session";
import { isEmptySnapshot, readSignupSnapshot } from "@/lib/signup-channel";
import { escapeTelegramHtml } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/demo-request — «Покажите мне за 15 минут» с публичных страниц.
 *
 * Без авторизации: человек ещё не клиент. Защита — скрытое поле-ловушка
 * (заполнено → отвечаем «ок» и ничего не сохраняем), обязательное согласие
 * на обработку персональных данных и лимит по IP. Заявка ложится в общий
 * список `ServiceRequest` (/root/service-requests), админ получает Telegram
 * и письмо; сбой уведомления заявку не теряет.
 */

const Schema = z.object({
  name: z.string().trim().min(2, "Укажите, как к вам обращаться").max(120),
  phone: z
    .string()
    .trim()
    .max(32)
    .refine(hasEnoughPhoneDigits, "Укажите телефон — по нему мы и перезвоним"),
  when: z.enum(DEMO_WHEN, "Выберите, когда удобно"),
  topic: z.string().trim().max(500).optional(),
  place: z.string().trim().max(40).optional(),
  consent: z.literal(true, "Отметьте согласие на обработку персональных данных"),
  website: z.string().max(200).optional(),
  source: z.unknown().optional(),
});

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  // Ловушка для ботов: поле скрыто от людей. Ответ тот же, что у живой
  // заявки, — бот не узнает, что его отсеяли.
  if (typeof body?.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные данные" },
      { status: 400 },
    );
  }

  const ip = clientIp(request) ?? "unknown";
  if (!demoRequestRateLimiter.consume(`demo:${ip}`)) {
    return NextResponse.json(
      { error: "Слишком много заявок. Попробуйте позже или позвоните нам" },
      { status: 429 },
    );
  }

  const session = await getServerSession(authOptions).catch(() => null);
  let organizationId: string | null = null;
  let organizationName: string | null = null;
  if (session) {
    organizationId = getActiveOrgId(session);
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
    organizationName = org?.name ?? null;
  }

  const source = readSignupSnapshot(parsed.data.source);
  const demo: DemoRequest = {
    name: parsed.data.name,
    phone: parsed.data.phone,
    when: parsed.data.when,
    topic: parsed.data.topic || null,
    place: parsed.data.place || "",
    source: isEmptySnapshot(source) ? null : source,
    organizationName,
  };

  let requestId: string;
  try {
    const row = await db.serviceRequest.create({
      data: {
        serviceKey: DEMO_SERVICE_KEY,
        serviceTitle: DEMO_SERVICE_TITLE,
        organizationId,
        organizationName,
        userId: session?.user?.id ?? null,
        contactName: demo.name,
        contactPhone: demo.phone,
        comment: composeDemoComment(demo),
        source: session ? "app" : "site",
      },
      select: { id: true },
    });
    requestId = row.id;
  } catch (error) {
    console.error("[demo-request] не удалось сохранить заявку:", error);
    return NextResponse.json(
      { error: "Не удалось отправить заявку. Попробуйте ещё раз или позвоните нам" },
      { status: 500 },
    );
  }

  const tgOk = await notifyPlatformAdmin(composeDemoAlert(demo, escapeTelegramHtml), {
    kind: "demo_request",
    dedupeKey: `demo:${requestId}`,
  }).catch(() => false);

  let emailOk = false;
  const adminEmail = getPlatformAdminEmail();
  if (adminEmail) {
    const lines = [`${demo.name}, ${demo.phone}`, organizationName, ...composeDemoComment(demo).split("\n")].filter(
      (line): line is string => Boolean(line),
    );
    emailOk = await sendRawEmail(
      adminEmail,
      `Показ за 15 минут: ${demo.name}`,
      `<h2>${escapeHtml(DEMO_SERVICE_TITLE)}</h2><p>${lines.map((line) => escapeHtml(line)).join("<br>")}</p>`,
    ).catch(() => false);
  }

  await db.serviceRequest
    .update({
      where: { id: requestId },
      data: {
        adminTgNotifiedAt: tgOk ? new Date() : null,
        adminEmailedAt: emailOk ? new Date() : null,
      },
    })
    .catch((error) => console.error("[demo-request] отметки доставки не записаны:", error));

  return NextResponse.json({ ok: true });
}
