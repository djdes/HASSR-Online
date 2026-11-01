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
  demoSlotLabel,
  hasEnoughPhoneDigits,
  type DemoRequest,
} from "@/lib/demo-request";
import { renderEmailLayout, sendRawEmail } from "@/lib/email";
import { demoIcs, isBookableSlot } from "@/lib/demo-slots";
import { SUPPORT_EMAIL } from "@/lib/support-chat-bus";
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
  /** «Перезвоните мне» — когда удобно; не нужно, если выбрано время. */
  when: z.enum(DEMO_WHEN, "Выберите, когда удобно").optional(),
  /** Выбранное время показа (ISO из `/api/demo-request/slots`). */
  slot: z.string().trim().max(40).optional(),
  email: z.string().trim().toLowerCase().email("Проверьте почту").max(160).optional().or(z.literal("")),
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
  if (!parsed.data.slot && !parsed.data.when) {
    return NextResponse.json({ error: "Выберите время показа или «Перезвоните мне»" }, { status: 400 });
  }
  const slot = parsed.data.slot ? normalizeSlot(parsed.data.slot) : null;
  if (parsed.data.slot && !slot) {
    return NextResponse.json({ error: "Это время уже недоступно — выберите другое", code: "slot-taken" }, { status: 409 });
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
    when: slot ? null : (parsed.data.when ?? null),
    slot,
    email: parsed.data.email || null,
    topic: parsed.data.topic || null,
    place: parsed.data.place || "",
    source: isEmptySnapshot(source) ? null : source,
    organizationName,
  };

  let requestId: string;
  try {
    const data = {
      serviceKey: DEMO_SERVICE_KEY,
      serviceTitle: DEMO_SERVICE_TITLE,
      organizationId,
      organizationName,
      userId: session?.user?.id ?? null,
      contactName: demo.name,
      contactPhone: demo.phone,
      contactEmail: demo.email ?? null,
      comment: composeDemoComment(demo),
      source: session ? "app" : "site",
      scheduledAt: slot ? new Date(slot) : null,
    };
    // Время показа — одно на заявку: замок на слот, проверка и запись в одной
    // транзакции, чтобы два человека не заняли одно и то же время.
    const row = slot
      ? await db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`demo-slot:${slot}`}))`;
          const now = new Date();
          const taken = await tx.serviceRequest.findMany({
            where: { serviceKey: DEMO_SERVICE_KEY, status: { not: "cancelled" }, scheduledAt: { gte: now } },
            select: { scheduledAt: true },
          });
          const takenKeys = new Set(taken.flatMap((item) => (item.scheduledAt ? [item.scheduledAt.toISOString()] : [])));
          if (!isBookableSlot(slot, now, takenKeys)) throw new SlotTakenError();
          return tx.serviceRequest.create({ data, select: { id: true } });
        })
      : await db.serviceRequest.create({ data, select: { id: true } });
    requestId = row.id;
  } catch (error) {
    if (error instanceof SlotTakenError) {
      return NextResponse.json({ error: "Это время уже заняли — выберите другое", code: "slot-taken" }, { status: 409 });
    }
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
      slot ? `Показ за 15 минут: ${demoSlotLabel(slot)}, ${demo.name}` : `Показ за 15 минут: ${demo.name}`,
      `<h2>${escapeHtml(DEMO_SERVICE_TITLE)}</h2><p>${lines.map((line) => escapeHtml(line)).join("<br>")}</p>`,
      slot ? { attachments: [inviteAttachment(slot, requestId, `Показ WeSetup: ${demo.name}, ${demo.phone}`)] } : undefined,
    ).catch(() => false);
  }

  // Клиенту — приглашение в календарь, если оставил почту и выбрал время.
  if (slot && demo.email) {
    await sendRawEmail(
      demo.email,
      `Показ WeSetup: ${demoSlotLabel(slot)}`,
      renderEmailLayout(
        "Показ WeSetup за 15 минут",
        `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">Здравствуйте, ${escapeHtml(demo.name)}! Записали вас на показ WeSetup: <b>${escapeHtml(demoSlotLabel(slot))}</b>. Позвоним на ${escapeHtml(demo.phone)} в это время — по видео или по телефону, как удобнее.</p>` +
          `<p style="margin:0;color:#6f7282;line-height:1.6;font-size:13px">Приглашение для календаря — во вложении. Нужно перенести — ответьте на это письмо.</p>`,
      ),
      { replyTo: SUPPORT_EMAIL, attachments: [inviteAttachment(slot, requestId, "Показ WeSetup за 15 минут")] },
    ).catch((error: unknown) => {
      console.error("[demo-request] invite email failed", error);
      return false;
    });
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

  return NextResponse.json({ ok: true, slot });
}

class SlotTakenError extends Error {}

/** Слот из браузера → ключ слота, если это вообще время показа (занятость — позже, под замком). */
function normalizeSlot(raw: string): string | null {
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return null;
  const key = date.toISOString();
  return isBookableSlot(key, new Date()) ? key : null;
}

function inviteAttachment(slot: string, requestId: string, summary: string) {
  return {
    filename: "wesetup-demo.ics",
    content: demoIcs({
      slot,
      uid: `demo-${requestId}`,
      summary,
      description: "Показ WeSetup за 15 минут. Позвоним в назначенное время. Поддержка: support@wesetup.ru",
    }),
    contentType: "text/calendar; charset=utf-8; method=PUBLISH",
  };
}
