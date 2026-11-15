import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { parseOrganizationProfilePatch, type OrgProfileField } from "@/lib/organization-profile-patch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Реквизиты клиента из карточки в панели (автосохранение, 2026-11-15).
 * Пишутся туда же, где их правит сам клиент в «Сведениях для документов»:
 * ИНН и правки поверх снимка ЕГРЮЛ. Пустое значение — «брать из ЕГРЮЛ».
 * Отсюда их берут договор, счета, КП и закрывающие документы.
 */
const CLIENT_REQUISITES_FIELDS: readonly OrgProfileField[] = [
  "inn",
  "legalFullName",
  "kpp",
  "ogrn",
  "legalAddress",
  "directorPost",
  "directorName",
];

async function save(request: Request, id: string) {
  const session = await requireRoot();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  const parsed = parseOrganizationProfilePatch(body, CLIENT_REQUISITES_FIELDS);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const keys = Object.keys(parsed.data);
  const before = await db.organization.findUnique({
    where: { id },
    select: Object.fromEntries(keys.map((key) => [key, true])),
  });
  if (!before) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  await db.organization.update({ where: { id }, data: parsed.data });
  await db.auditLog
    .create({
      data: {
        organizationId: id,
        userId: session.user.id,
        userName: session.user.name ?? session.user.email ?? "root",
        action: "organization.requisites.update",
        entity: "Organization",
        entityId: id,
        details: { before, after: parsed.data, source: "root-client-card" } as never,
      },
    })
    .catch((error) => console.error("[root/requisites] audit failed", error));
  return NextResponse.json({ ok: true, saved: parsed.data });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return save(request, (await params).id);
}

/** То же для `navigator.sendBeacon` при закрытии вкладки (он шлёт только POST). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return save(request, (await params).id);
}
