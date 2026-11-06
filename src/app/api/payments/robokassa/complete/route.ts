import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { hashInviteToken } from "@/lib/invite-tokens";
import { normalizePhone } from "@/lib/phone";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Достройка профиля после оплаты.
 *
 * После вебхука у клиента уже есть организация и пользователь, но с
 * техническим названием и случайным паролем. Здесь он задаёт реальные
 * данные по одноразовому токену из письма/success-возврата.
 *
 * Токен одноразовый: по завершении обнуляем `completeTokenHash`, поэтому
 * повторный сабмит той же ссылкой ничего не перезапишет.
 */

const completeRateLimiter = createRateLimiter({
  tokensPerInterval: 10,
  intervalMs: 10 * 60 * 1000,
});

export async function POST(request: Request) {
  const xff = request.headers.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0].trim() || "unknown";
  if (!completeRateLimiter.consume(`payment-complete:${ip}`)) {
    return NextResponse.json(
      { error: "Слишком много попыток. Подождите несколько минут" },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const organizationName =
    typeof body.organizationName === "string"
      ? body.organizationName.trim()
      : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const phone = normalizePhone(
    typeof body.phone === "string" ? body.phone : null,
  );

  if (!token) {
    return NextResponse.json({ error: "Ссылка недействительна" }, { status: 400 });
  }
  if (!organizationName || !name) {
    return NextResponse.json(
      { error: "Укажите название организации и ваше имя" },
      { status: 400 },
    );
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Пароль должен быть не короче 6 символов" },
      { status: 400 },
    );
  }
  if (!phone) {
    return NextResponse.json(
      { error: "Укажите телефон в формате +7XXXXXXXXXX" },
      { status: 400 },
    );
  }

  const order = await db.paymentOrder.findUnique({
    where: { completeTokenHash: hashInviteToken(token) },
  });
  if (!order || !order.organizationId || !order.userId) {
    return NextResponse.json({ error: "Ссылка недействительна" }, { status: 404 });
  }
  if (order.status !== "paid") {
    return NextResponse.json(
      { error: "Заказ ещё не оплачен или уже завершён" },
      { status: 409 },
    );
  }
  if (
    !order.completeTokenExpiresAt ||
    order.completeTokenExpiresAt.getTime() < Date.now()
  ) {
    return NextResponse.json(
      { error: "Срок действия ссылки истёк. Напишите на admin@wesetup.ru" },
      { status: 410 },
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await db.$transaction(async (tx) => {
    await tx.organization.update({
      where: { id: order.organizationId! },
      data: { name: organizationName },
    });
    await tx.user.update({
      where: { id: order.userId! },
      data: { name, phone, passwordHash },
    });
    await tx.paymentOrder.update({
      where: { id: order.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        completeTokenHash: null,
        completeTokenExpiresAt: null,
      },
    });
  });

  // Email возвращаем, чтобы клиент сразу залогинился тем же паролем.
  return NextResponse.json({ ok: true, email: order.email });
}
