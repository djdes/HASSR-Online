import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyEmailPassword } from "@/lib/credentials";
import { loginRateLimiter } from "@/lib/rate-limit";
import { hasAnyUserRole } from "@/lib/user-roles";
import {
  generateAgentToken,
  hashAgentToken,
} from "@/lib/print-agent-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/print/agents/auth — подключение программы «Онлайн принтер».
 *
 * Пользователь вводит в программе тот же email и пароль, что и на сайте.
 * В обмен сервер выдаёт долгоживущий токен агента; пароль на диск машины
 * не попадает и больше не запрашивается — это и есть автологин после
 * перезагрузки.
 *
 * Проверка пары — общим `verifyEmailPassword`, тем же, что у входа на
 * сайт: защита от перебора и от подбора существующих адресов должна быть
 * одна на оба входа.
 */

/** Кому можно ставить агент. */
const ALLOWED_ROLES = ["owner", "manager", "technologist", "head_chef"] as const;

export async function POST(request: Request) {
  let body: {
    email?: unknown;
    password?: unknown;
    deviceName?: unknown;
    agentVersion?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const deviceName = String(body.deviceName ?? "").trim().slice(0, 100);
  const agentVersion = String(body.agentVersion ?? "").trim().slice(0, 40);

  if (!email || !password) {
    return NextResponse.json(
      { error: "Введите email и пароль" },
      { status: 400 },
    );
  }
  if (!deviceName) {
    return NextResponse.json(
      { error: "Укажите название этой машины — например «Касса»" },
      { status: 400 },
    );
  }

  const xff = request.headers.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0].trim() || "unknown";
  if (!loginRateLimiter.consume(`print-agent:${ip}`)) {
    return NextResponse.json(
      { error: "Слишком много попыток входа. Подождите 5 минут." },
      { status: 429 },
    );
  }

  const user = await verifyEmailPassword(email, password);
  if (!user) {
    return NextResponse.json(
      { error: "Неверный email или пароль" },
      { status: 401 },
    );
  }

  // Повару агент ставить незачем, а его токен давал бы принтеру задания
  // всей организации.
  if (!hasAnyUserRole(user.role, ALLOWED_ROLES)) {
    return NextResponse.json(
      {
        error:
          "Подключить принтер может управляющий или заведующий производством",
      },
      { status: 403 },
    );
  }

  const raw = generateAgentToken();

  // Переустановка на той же машине не должна плодить призраков в списке:
  // прежние агенты с этим именем отзываем. Строки остаются — история
  // печати не должна терять, где что печаталось.
  await db.printAgent.updateMany({
    where: {
      organizationId: user.organizationId,
      name: deviceName,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  const agent = await db.printAgent.create({
    data: {
      organizationId: user.organizationId,
      createdById: user.id,
      name: deviceName,
      tokenHash: hashAgentToken(raw),
      agentVersion: agentVersion || null,
    },
    select: { id: true },
  });

  // Плейнтекст токена отдаётся ровно здесь и больше нигде.
  return NextResponse.json({
    agentToken: raw,
    agentId: agent.id,
    organizationName: user.organization.name,
    userName: user.name,
  });
}
