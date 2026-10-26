import { NextResponse } from "next/server";
import { z } from "zod";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { checkPlanFeature, limitResponse } from "@/lib/billing.server";
import { normalizeAutoProcessMode } from "@/lib/mercury/access";
import { getServerSession } from "@/lib/server-session";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Подключение организации к ФГИС «Меркурий».
 *
 * Обратите внимание, чего в схеме НЕТ: поля `apiKey`. APIKey выдаётся
 * один на информационную систему (на весь WeSetup) и живёт в env — у
 * клиента его нет и быть не должно. От клиента нужны ГУИД
 * хозяйствующего субъекта и логин уполномоченного лица: это
 * идентификаторы из его кабинета Меркурия, не секреты.
 */
const connectSchema = z.object({
  // ГУИД в Ветис — 36-символьный uuid, но встречаются и «сырые» строки,
  // поэтому проверяем мягко и не мешаем подключиться из-за формата.
  issuerGuid: z.string().trim().min(8).max(64),
  initiatorLogin: z.string().trim().min(1).max(128),
  environment: z.enum(["test", "prod"]).default("test"),
  label: z.string().trim().max(120).optional(),
});

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  autoProcessMode: z.enum(["off", "assisted", "auto_after_journal"]).optional(),
  autoSupplierInns: z.array(z.string().trim().min(8).max(12)).optional(),
  notifyUserId: z.string().nullable().optional(),
  initiatorLogin: z.string().trim().min(1).max(128).optional(),
});

async function guard() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Не авторизован" }, { status: 401 }) };
  }
  if (!hasFullWorkspaceAccess(session.user)) {
    return {
      error: NextResponse.json(
        { error: "Настройка интеграций доступна руководству" },
        { status: 403 },
      ),
    };
  }
  const organizationId = getActiveOrgId(session);
  // «Меркурий» — возможность «Премиума» (и пробного, прежней «Подписки», демо).
  const feature = await checkPlanFeature(organizationId, "mercury", "mercury.settings");
  if (!feature.ok) return { error: limitResponse(feature) };
  return { organizationId };
}

export async function POST(request: Request) {
  const g = await guard();
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Проверьте ГУИД и логин", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const integration = await db.mercuryIntegration.upsert({
    where: { organizationId: g.organizationId! },
    create: {
      organizationId: g.organizationId!,
      issuerGuid: parsed.data.issuerGuid,
      initiatorLogin: parsed.data.initiatorLogin,
      environment: parsed.data.environment,
      label: parsed.data.label ?? null,
      // Включаем только после того, как менеджер сопоставит площадки:
      // без них синхронизировать нечего.
      enabled: false,
      autoProcessMode: "assisted",
    },
    update: {
      issuerGuid: parsed.data.issuerGuid,
      initiatorLogin: parsed.data.initiatorLogin,
      environment: parsed.data.environment,
      label: parsed.data.label ?? null,
    },
    select: { id: true, enabled: true, environment: true },
  });

  return NextResponse.json({ ok: true, integration });
}

export async function PATCH(request: Request) {
  const g = await guard();
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Неверные настройки" }, { status: 400 });
  }

  const data = parsed.data;
  const updated = await db.mercuryIntegration.update({
    where: { organizationId: g.organizationId! },
    data: {
      ...(data.enabled === undefined ? {} : { enabled: data.enabled }),
      ...(data.autoProcessMode
        ? { autoProcessMode: normalizeAutoProcessMode(data.autoProcessMode) }
        : {}),
      ...(data.autoSupplierInns
        ? { autoSupplierInns: data.autoSupplierInns as never }
        : {}),
      ...(data.notifyUserId === undefined ? {} : { notifyUserId: data.notifyUserId }),
      ...(data.initiatorLogin ? { initiatorLogin: data.initiatorLogin } : {}),
    },
    select: { enabled: true, autoProcessMode: true },
  });

  return NextResponse.json({ ok: true, ...updated });
}

export async function DELETE() {
  const g = await guard();
  if (g.error) return g.error;

  // Отключаем, но НЕ удаляем: история погашенных ВСД — часть
  // доказательной базы приёмки и должна пережить отключение.
  await db.mercuryIntegration.update({
    where: { organizationId: g.organizationId! },
    data: { enabled: false },
  });
  return NextResponse.json({ ok: true });
}
