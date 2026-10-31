import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { decryptSecret, encryptSecret, isIntegrationCryptoConfigured } from "@/lib/integration-crypto";
import { createZupClient, ZupError } from "@/lib/hr1c/odata";
import { guardSupply } from "@/lib/supply/guard.server";
import { assertPublicBaseUrl, UnsafeUrlError } from "@/lib/supply/safe-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  odataUrl: z.string().trim().max(300).optional(),
  login: z.string().trim().max(200).optional(),
  password: z.string().max(200).optional(),
  defaultPositionId: z.string().trim().max(60).nullish(),
  autoApply: z.boolean().optional(),
});

/**
 * PUT /api/settings/hr1c — подключить 1С:ЗУП. С адресом OData — проверка
 * входом (справочник должностей) и логин/пароль зашифрованными; без адреса —
 * только API для обработки 1С. Должность по умолчанию и автоприменение —
 * здесь же. Логин и пароль можно не присылать повторно: останутся прежние.
 *
 * DELETE — отключить; связи сотрудников и сами сотрудники остаются.
 */
export async function PUT(request: Request) {
  const { session, organizationId, denied } = await guardSupply();
  if (denied) return denied;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректные настройки" }, { status: 400 });
  const body = parsed.data;
  if (body.defaultPositionId) {
    const position = await db.jobPosition.findFirst({ where: { id: body.defaultPositionId, organizationId }, select: { id: true } });
    if (!position) return NextResponse.json({ error: "Должность не найдена" }, { status: 400 });
  }
  const existing = await db.hrConnection.findUnique({ where: { organizationId } });

  let odataUrl: string | null = null;
  let credentialsEnc: string | null = null;
  if (body.odataUrl) {
    if (!isIntegrationCryptoConfigured()) {
      return NextResponse.json({ error: "На сервере не настроено шифрование ключей" }, { status: 500 });
    }
    // Не прислали логин или пароль — остаются сохранённые.
    let stored: { login?: string; password?: string } = {};
    if (existing?.credentialsEnc) {
      try {
        stored = JSON.parse(decryptSecret(existing.credentialsEnc)) as { login?: string; password?: string };
      } catch {
        stored = {};
      }
    }
    const login = body.login || stored.login || "";
    const password = body.password || stored.password || "";
    if (!login || !password) return NextResponse.json({ error: "Укажите логин и пароль пользователя OData" }, { status: 400 });
    try {
      odataUrl = await assertPublicBaseUrl(body.odataUrl);
      await createZupClient({ baseUrl: odataUrl, login, password }).positions();
    } catch (error) {
      if (error instanceof ZupError || error instanceof UnsafeUrlError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
    credentialsEnc = encryptSecret(JSON.stringify({ login, password }));
  }

  const data = {
    odataUrl,
    credentialsEnc,
    defaultPositionId: body.defaultPositionId ?? null,
    autoApply: body.autoApply ?? false,
    lastError: null,
    createdById: session.user.id,
  };
  await db.hrConnection.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data });
  return NextResponse.json({ ok: true, odataUrl, autoApply: data.autoApply });
}

export async function DELETE() {
  const { organizationId, denied } = await guardSupply();
  if (denied) return denied;
  await db.hrConnection.deleteMany({ where: { organizationId } });
  return NextResponse.json({ ok: true });
}
