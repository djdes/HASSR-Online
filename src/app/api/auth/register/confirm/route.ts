import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import {
  VERIFICATION_MAX_ATTEMPTS,
  compareVerificationCode,
} from "@/lib/registration";
import { sendWelcomeEmail } from "@/lib/email";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { escapeTelegramHtml } from "@/lib/telegram";
import { normalizePhone } from "@/lib/phone";
import { registrationConfirmRateLimiter } from "@/lib/rate-limit";
import { defaultJournalAutomationJson } from "@/lib/journal-automation";
import { DEFAULT_OFF_JOURNAL_CODES } from "@/lib/health-check-default-off";
import { attachAccountForNewOrganization } from "@/lib/create-organization";
import {
  attachOrganizationByRef,
  readPartnerRefFromRequest,
} from "@/lib/partners/referral";
import { REFERRAL_COOKIE, readCookie } from "@/lib/balance/constants";
import { attachReferral, resolveReferrerByCode } from "@/lib/balance/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_PLANS = new Set(["basic", "extended", "free"]);

/**
 * POST /api/auth/register/confirm
 *
 * Step 2 of the wizard. Validates the 6-digit code issued by /request,
 * then creates the Organization + manager User in a single transaction.
 * Plan is taken from the request body (`basic` | `extended`, default
 * `trial` for legacy compatibility). On success the EmailVerification row
 * is deleted so a token can't be replayed.
 *
 * Returns 400 on expired/wrong code, 409 if the email has been claimed
 * between /request and /confirm (very unlikely but possible), 201 on
 * success with the new user id.
 */
export async function POST(request: Request) {
  // Per-IP throttle поверх non-atomic attempts-counter в БД. Защита
  // от concurrent-параллельного перебора 6-значного кода.
  const xff = request.headers.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0].trim() || "unknown";
  // «unknown» — рабочий ключ для rate-limit, но в БД от него нет пользы.
  const ipForLog = ip === "unknown" ? null : ip;
  if (!registrationConfirmRateLimiter.consume(`confirm:${ip}`)) {
    return NextResponse.json(
      { error: "Слишком много попыток. Подождите 5 минут." },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  // Phone is required now — every account needs to be linkable to a
  // TasksFlow worker, which keys off phone. Accept any format the user
  // types and normalize to `+7XXXXXXXXXX`.
  const phone = normalizePhone(
    typeof body.phone === "string" ? body.phone : null
  );
  const organizationName =
    typeof body.organizationName === "string"
      ? body.organizationName.trim()
      : "";
  const organizationType =
    typeof body.organizationType === "string" && body.organizationType
      ? body.organizationType
      : "other";
  const inn =
    typeof body.inn === "string" && body.inn.trim().length > 0
      ? body.inn.trim()
      : null;
  const plan =
    typeof body.plan === "string" && VALID_PLANS.has(body.plan)
      ? body.plan
      : "free";

  if (!email || !code || !password || !name || !organizationName) {
    return NextResponse.json(
      { error: "Не все поля заполнены" },
      { status: 400 }
    );
  }
  if (!phone) {
    return NextResponse.json(
      { error: "Укажите телефон в формате +7XXXXXXXXXX — без него не получится связать аккаунт с TasksFlow" },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Пароль должен быть не короче 6 символов" },
      { status: 400 }
    );
  }

  const verification = await db.emailVerification.findUnique({
    where: { email },
  });
  if (!verification) {
    return NextResponse.json(
      { error: "Сначала запросите код подтверждения" },
      { status: 400 }
    );
  }
  if (verification.expiresAt.getTime() < Date.now()) {
    await db.emailVerification.delete({ where: { email } });
    return NextResponse.json(
      { error: "Код устарел. Запросите новый" },
      { status: 400 }
    );
  }
  if (verification.attempts >= VERIFICATION_MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: "Слишком много попыток. Запросите новый код" },
      { status: 429 }
    );
  }

  const codeOk = await compareVerificationCode(code, verification.codeHash);
  if (!codeOk) {
    await db.emailVerification.update({
      where: { email },
      data: { attempts: { increment: 1 } },
    });
    return NextResponse.json(
      { error: "Неверный код" },
      { status: 400 }
    );
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "Пользователь с таким email уже существует" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: organizationName,
        type: organizationType,
        inn,
        subscriptionPlan: plan,
        // Автоматика гигиенического журнала — сразу после регистрации.
        journalAutomationJson: defaultJournalAutomationJson(),
        // Журнал здоровья выключен по умолчанию (health-check-default-off.ts).
        disabledJournalCodes: [...DEFAULT_OFF_JOURNAL_CODES],
      },
    });

    // Должности НЕ сеедим — у каждой компании свой набор. Менеджер
    // создаст нужные позиции сам на /settings/users (кнопка «+» внутри
    // Руководство / Сотрудники). Раньше засеиваем 18 стандартных
    // позиций «Шеф-повар / Повар горячего цеха / …», но у малой
    // компании из 2 человек это только мусор в интерфейсе.
    const user = await tx.user.create({
      data: {
        email,
        name,
        phone,
        passwordHash,
        role: "manager",
        organizationId: organization.id,
        // jobPositionId — null на старте. positionTitle тоже пустой,
        // пусть менеджер впишет что ему удобно.
        journalAccessMigrated: true,
        // Почта подтверждена самим фактом попадания сюда: выше сверен код
        // из письма (`compareVerificationCode`), а получить его можно
        // только имея доступ к ящику. Без этой строки человек, только что
        // подтвердивший адрес, видел в настройках баннер «подтвердите
        // почту» и проходил ту же проверку второй раз.
        emailVerifiedAt: new Date(),
        // Подтверждение кода завершается автоматическим входом, поэтому
        // адрес регистрации он же и адрес первого входа.
        registrationIp: ipForLog,
        lastLoginIp: ipForLog,
        lastLoginAt: new Date(),
      },
    });

    await tx.emailVerification.delete({ where: { email } });

    // Аккаунт — владелец тарифа и общего лимита мест. Заводим сразу:
    // без него организация не умеет ни переключаться, ни расти во
    // вторую точку (см. lib/create-organization.ts).
    await attachAccountForNewOrganization(tx, {
      ownerUserId: user.id,
      organizationId: organization.id,
      subscriptionPlan: organization.subscriptionPlan,
      subscriptionEnd: organization.subscriptionEnd,
    });

    return { organization, user };
  });

  sendWelcomeEmail({
    to: result.user.email,
    name: result.user.name,
    organizationName: result.organization.name,
    organizationId: result.organization.id,
  }).catch((err) => console.error("sendWelcomeEmail failed", err));

  // Регистрации через /register раньше не уведомляли никого: новые
  // организации появлялись молча, и владелец узнавал о них случайно.
  notifyPlatformAdmin(
    [
      "🆕 Регистрация организации",
      `Название: ${escapeTelegramHtml(result.organization.name)}`,
      `Почта: ${escapeTelegramHtml(result.user.email)}`,
      `Имя: ${escapeTelegramHtml(result.user.name)}`,
    ].join("\n"),
    { kind: "registration" }
  ).catch((err) => console.error("register notify admin failed", err));

  // Регистрация по партнёрской ссылке (/p/<slug>) — организация сразу
  // под сопровождением партнёра. Best-effort, регистрацию не ломает.
  await attachOrganizationByRef({
    ref: readPartnerRefFromRequest(request),
    organizationId: result.organization.id,
    actorUserId: result.user.id,
  });

  // Реферальная ссылка клиента (/r/<code>): кто привёл эту организацию.
  // Баллы рекомендателю начислим, когда она оплатит подписку.
  await attachReferral({
    organizationId: result.organization.id,
    referrerOrganizationId:
      (await resolveReferrerByCode(readCookie(request, REFERRAL_COOKIE)))?.id ??
      null,
    actorUserId: result.user.id,
  });

  return NextResponse.json(
    {
      ok: true,
      userId: result.user.id,
      organizationId: result.organization.id,
    },
    { status: 201 }
  );
}
