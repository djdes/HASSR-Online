import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isManagementRole } from "@/lib/user-roles";
import { recordAuditLog } from "@/lib/audit-log";
import { buildStaffLogin, loginSuffixSchema } from "@/lib/login-prefix";
import { checkUserActivation, seatLimitResponse } from "@/lib/billing.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/staff/[id]/credentials — доступ в кабинет через браузер.
 *
 * Сотрудник заводится с синтетической почтой и пустым `passwordHash`:
 * войти он не может, пока руководитель не выдаст логин и пароль. У
 * линейного персонала почты часто нет вовсе, поэтому логин придумывает
 * управляющая, а личный адрес живёт отдельным полем `contactEmail`.
 *
 * Префикс логина собирает СЕРВЕР из номера организации — клиент его
 * только показывает. Иначе подделанный префикс позволил бы занять логин
 * в чужом заведении: `User.email` уникален на всю платформу.
 */

const schema = z.object({
  /** Что человек вписал сам. Префикс добавит сервер. */
  loginSuffix: loginSuffixSchema.optional(),
  password: z
    .string()
    .min(6, "Пароль от 6 символов")
    .max(200, "Пароль слишком длинный")
    .optional(),
  /** Личная почта — необязательна и логином не является. */
  contactEmail: z
    .union([z.string().trim().email("Некорректный email"), z.literal("")])
    .optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth();
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { id } = await params;
  const orgId = getActiveOrgId(session);

  let parsed;
  try {
    parsed = schema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Некорректные данные" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Не удалось прочитать запрос" }, { status: 400 });
  }

  const user = await db.user.findFirst({
    where: { id, organizationId: orgId },
    select: { id: true, name: true, email: true, passwordHash: true, isActive: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
  }

  const organization = await db.organization.findUnique({
    where: { id: orgId },
    select: { orgNo: true },
  });
  if (!organization) {
    return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  }

  const data: {
    email?: string;
    passwordHash?: string;
    contactEmail?: string | null;
    isActive?: boolean;
  } = {};

  if (parsed.contactEmail !== undefined) {
    data.contactEmail = parsed.contactEmail === "" ? null : parsed.contactEmail;
  }

  // Логин меняем только когда его прислали: смена пароля уже выданному
  // доступу не должна молча переименовывать вход.
  const login = parsed.loginSuffix
    ? buildStaffLogin(organization.orgNo, parsed.loginSuffix)
    : null;

  if (parsed.password) {
    if (!login && !user.passwordHash) {
      return NextResponse.json(
        { error: "Укажите логин — сотрудник ещё не может войти" },
        { status: 400 }
      );
    }
    // Пароль включает неактивного сотрудника — это место в тарифе.
    if (!user.isActive) {
      const seats = await checkUserActivation(user.id, { source: "staff.credentials" });
      if (!seats.ok) return seatLimitResponse(seats);
    }
    data.passwordHash = await bcrypt.hash(parsed.password, 10);
    data.isActive = true;
  }

  if (login) {
    if (!parsed.password && !user.passwordHash) {
      return NextResponse.json(
        { error: "Укажите пароль — с одним логином войти нельзя" },
        { status: 400 }
      );
    }
    // Занятость проверяем заранее: иначе Prisma отдаст P2002, и человек
    // увидит «Ошибка» вместо «такой логин уже занят».
    const taken = await db.user.findFirst({
      where: { email: login, id: { not: user.id } },
      select: { id: true },
    });
    if (taken) {
      return NextResponse.json({ error: "Такой логин уже занят" }, { status: 409 });
    }
    data.email = login;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, login: user.email });
  }

  try {
    await db.user.update({ where: { id: user.id }, data });
  } catch (error) {
    // Гонка двух выдач на один логин: уникальный индекс — последний рубеж.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "Такой логин уже занят" }, { status: 409 });
    }
    throw error;
  }

  await recordAuditLog({
    request,
    session,
    organizationId: orgId,
    action: "staff.credentials.issue",
    entity: "User",
    entityId: user.id,
    // Пароль в лог не пишем никогда — только факт выдачи и логин.
    details: {
      login: login ?? user.email,
      passwordChanged: Boolean(parsed.password),
      name: user.name,
    },
  });

  return NextResponse.json({ ok: true, login: login ?? user.email });
}
