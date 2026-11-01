import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { ensureLocationBuildings } from "@/lib/location-buildings";
import { refreshOrganizationLegalProfile } from "@/lib/org-legal-profile";
import { MAX_LOCATIONS } from "@/lib/org-profile";
import {
  parseOrganizationProfilePatch,
  type OrgProfileField,
} from "@/lib/organization-profile-patch";
import { readJson, requirePartnerApi } from "@/lib/partners/api";
import { getPartnerClientCard } from "@/lib/partners/client-card";
import { partnerErrorResponse } from "@/lib/partners/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Карточка клиента: организация, привязка, заметки, начисления по клиенту. */
export async function GET(_request: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const auth = await requirePartnerApi();
  if (!auth.ok) return auth.response;
  const { orgId } = await ctx.params;
  try {
    return NextResponse.json(await getPartnerClientCard(auth.ctx.membership.partnerId, orgId));
  } catch (error) {
    return partnerErrorResponse(error);
  }
}

/**
 * Что консультант правит прямо с карточки.
 *
 * Только реквизиты заведения — то, за чем не стоит переключать контекст.
 * Оформление клиента (цвет, логотип), почта бухгалтерии, язык и политика
 * комплаенса сюда не входят: их меняет клиент у себя, а консультант —
 * через «Открыть кабинет», где работают обычные настройки.
 */
const PARTNER_EDITABLE_FIELDS: readonly OrgProfileField[] = [
  "name",
  "journalShortName",
  "type",
  "ownershipKind",
  "inn",
  "address",
  "phone",
  "timezone",
];

/**
 * PATCH — консультант правит реквизиты организации клиента.
 *
 * Отдельный роут, а не `/api/settings/organization`: тот берёт цель из
 * `getActiveOrgId(session)`, а в партнёрском кабинете это организация
 * самого партнёра — правка ушла бы не туда.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const auth = await requirePartnerApi();
  if (!auth.ok) return auth.response;
  const { session, membership } = auth.ctx;
  const { orgId } = await ctx.params;

  const link = await db.partnerClient.findFirst({
    where: { partnerId: membership.partnerId, organizationId: orgId },
    select: { id: true, detachedAt: true, accessLevel: true },
  });
  if (!link) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
  if (link.detachedAt) {
    return NextResponse.json(
      { error: "Сопровождение отключено — организация вам больше не доступна", code: "detached" },
      { status: 409 },
    );
  }
  // Реквизиты клиента меняет только партнёр с доступом «редактирование»
  // (аудит 2026-11-01): интерфейс прятал форму при «просмотре», а прямой
  // запрос проходил и менял организацию клиента.
  if (link.accessLevel !== "edit") {
    return NextResponse.json(
      { error: "Клиент дал доступ только на просмотр — реквизиты меняет он сам", code: "view_only" },
      { status: 403 },
    );
  }

  const body = await readJson<Record<string, unknown>>(request);
  const parsed = parseOrganizationProfilePatch(body, PARTNER_EDITABLE_FIELDS);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const data = parsed.data;

  // Свой ИНН клиенту вписать нельзя: `isPartnerOwnOrganization` сверяется
  // только в момент привязки, и иначе инвариант «собственная организация
  // партнёра — не его клиент» обходится задним числом.
  if (typeof data.inn === "string") {
    const partner = await db.partner.findUnique({
      where: { id: membership.partnerId },
      select: { inn: true },
    });
    if (partner && partner.inn === data.inn) {
      return NextResponse.json(
        { error: "Это ИНН вашей компании — у клиента он быть не может", code: "own_organization" },
        { status: 409 },
      );
    }
  }

  // Число точек живёт не в общем парсере: на /settings/organization оно
  // намеренно только для чтения, а здесь его правит консультант.
  let locationsCount: number | null = null;
  if ("locationsCount" in body) {
    const raw = Math.floor(Number(body.locationsCount));
    if (!Number.isFinite(raw) || raw < 1 || raw > MAX_LOCATIONS) {
      return NextResponse.json({ error: "Точек — от 1" }, { status: 400 });
    }
    locationsCount = raw;
    data.locationsCount = raw;
  }

  const before = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      name: true,
      journalShortName: true,
      type: true,
      ownershipKind: true,
      inn: true,
      address: true,
      phone: true,
      timezone: true,
      locationsCount: true,
    },
  });

  const updated = await db.organization.update({
    where: { id: orgId },
    data,
    select: {
      name: true,
      journalShortName: true,
      type: true,
      ownershipKind: true,
      inn: true,
      address: true,
      phone: true,
      timezone: true,
      locationsCount: true,
    },
  });

  // Значения выбранных полей — строки, числа и null, поэтому запись
  // ложится в JSON аудита как есть.
  type Scalar = string | number | null;
  const changed: Record<string, { from: Scalar; to: Scalar }> = {};
  for (const key of Object.keys(data)) {
    const from = (before?.[key as keyof typeof before] ?? null) as Scalar;
    const to = (updated[key as keyof typeof updated] ?? null) as Scalar;
    if (from !== to) changed[key] = { from, to };
  }

  await db.auditLog
    .create({
      data: {
        organizationId: orgId,
        userId: session.user.id,
        userName: `партнёр: ${membership.partner.brandName}, ${session.user.name ?? session.user.email ?? "сотрудник"}`,
        action: "partner.org_updated",
        entity: "organization",
        entityId: orgId,
        details: { partnerId: membership.partnerId, changed },
      },
    })
    .catch((err) => console.error("partner org update audit failed", err));

  if (locationsCount !== null && locationsCount >= 2) {
    await ensureLocationBuildings(orgId, locationsCount, {
      firstAddress: updated.address,
    }).catch((err) => console.error("partner org buildings failed", err));
  }

  if (typeof data.inn === "string" && data.inn !== before?.inn) {
    void refreshOrganizationLegalProfile(orgId, data.inn).catch(() => null);
  }

  return NextResponse.json({ ok: true, organization: updated });
}
