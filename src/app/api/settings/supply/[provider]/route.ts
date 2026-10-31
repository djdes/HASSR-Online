import { NextResponse } from "next/server";

import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { describeSabyError, sabyAppLogin, SabyRpcError } from "@/lib/edo/saby/rpc";
import { encryptSecret, isIntegrationCryptoConfigured } from "@/lib/integration-crypto";
import {
  connectionView,
  diadocBaseUrl,
  diadocCredentialsSchema,
  iikoCredentialsSchema,
  iikoOptionsSchema,
  isSupplyProvider,
  sabyCredentialsSchema,
} from "@/lib/supply/connections";
import { createDiadocClient, DiadocError } from "@/lib/supply/diadoc";
import { guardSupply } from "@/lib/supply/guard.server";
import { createIikoClient, IikoError } from "@/lib/supply/iiko";
import { assertPublicServerUrl, UnsafeUrlError } from "@/lib/supply/safe-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUT /api/settings/supply/[diadoc|saby|iiko] — подключить ЭДО для входящих
 * накладных или iiko (накладные, списания, номенклатура). Ключи проверяются входом и только потом сохраняются —
 * зашифрованными; в ответе — только маска (логин, ящик), без секретов.
 * У Диадока с несколькими ящиками первый ответ — список ящиков (`needBox`),
 * второй запрос — с выбранным `boxId`.
 *
 * DELETE — отключить: ключи удаляются, загруженные накладные остаются.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { session, organizationId, denied } = await guardSupply();
  if (denied) return denied;
  const { provider } = await params;
  if (!isSupplyProvider(provider)) return NextResponse.json({ error: "Неизвестный ЭДО" }, { status: 404 });
  if (!isIntegrationCryptoConfigured()) {
    return NextResponse.json({ error: "На сервере не настроено шифрование ключей" }, { status: 500 });
  }
  const body: unknown = await request.json().catch(() => null);

  let credentials: Record<string, unknown>;
  let boxId: string | null = null;
  let boxTitle: string | null = null;
  let sessionEnc: string | null = null;
  try {
    if (provider === "iiko") {
      const parsed = iikoCredentialsSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Заполните адрес сервера, логин и пароль iiko" }, { status: 400 });
      const options = iikoOptionsSchema.parse((body as { options?: unknown }).options ?? {});
      const serverUrl = await assertPublicServerUrl(parsed.data.serverUrl);
      // Проверка входом: войти и сразу выйти — лицензию сервера не держим.
      await createIikoClient({ ...parsed.data, serverUrl }).withSession(async () => true);
      credentials = { ...parsed.data, serverUrl, options };
      boxTitle = serverUrl;
    } else if (provider === "diadoc") {
      const parsed = diadocCredentialsSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Заполните ключ разработчика, логин и пароль" }, { status: 400 });
      const boxes = await createDiadocClient(parsed.data, { baseUrl: diadocBaseUrl() }).listBoxes();
      if (boxes.length === 0) return NextResponse.json({ error: "У этого логина нет ящиков организаций в Диадоке" }, { status: 400 });
      const requested = typeof (body as { boxId?: unknown }).boxId === "string" ? (body as { boxId: string }).boxId : null;
      const box = requested ? boxes.find((item) => item.boxId === requested) : boxes.length === 1 ? boxes[0] : null;
      if (!box) {
        if (requested) return NextResponse.json({ error: "Такого ящика у этого логина нет" }, { status: 400 });
        return NextResponse.json({ needBox: true, boxes });
      }
      credentials = parsed.data;
      boxId = box.boxId;
      boxTitle = box.inn ? `${box.title} (ИНН ${box.inn})` : box.title;
    } else {
      const parsed = sabyCredentialsSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Заполните ID подключения и защищённый ключ" }, { status: 400 });
      }
      const sessionValue = await sabyAppLogin(parsed.data);
      credentials = parsed.data;
      sessionEnc = encryptSecret(JSON.stringify(sessionValue));
    }
  } catch (error) {
    if (error instanceof DiadocError || error instanceof IikoError || error instanceof UnsafeUrlError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SabyRpcError) return NextResponse.json({ error: describeSabyError(error) }, { status: 400 });
    throw error;
  }

  const data = {
    credentialsEnc: encryptSecret(JSON.stringify(credentials)),
    sessionEnc,
    boxId,
    boxTitle,
    status: "active",
    lastError: null,
    createdById: session.user.id,
  };
  const row = await db.supplyConnection.upsert({
    where: { organizationId_provider: { organizationId, provider } },
    create: { organizationId, provider, ...data },
    update: data,
  });
  await logAudit({
    organizationId,
    userId: session.user.id,
    userName: session.user.name ?? undefined,
    action: "supply.connect",
    entity: "SupplyConnection",
    entityId: row.id,
    details: { provider },
  });
  return NextResponse.json({ connected: true, view: connectionView(provider, credentials, row) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { session, organizationId, denied } = await guardSupply();
  if (denied) return denied;
  const { provider } = await params;
  if (!isSupplyProvider(provider)) return NextResponse.json({ error: "Неизвестный ЭДО" }, { status: 404 });
  const removed = await db.supplyConnection.deleteMany({ where: { organizationId, provider } });
  if (removed.count > 0) {
    await logAudit({
      organizationId,
      userId: session.user.id,
      userName: session.user.name ?? undefined,
      action: "supply.disconnect",
      entity: "SupplyConnection",
      details: { provider },
    });
  }
  return NextResponse.json({ ok: true });
}
