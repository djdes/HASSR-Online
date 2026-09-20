import { NextResponse } from "next/server";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { innDigits, isValidInn } from "@/lib/inn";
import { refreshOrganizationLegalProfile } from "@/lib/org-legal-profile";
import { hasCapability } from "@/lib/permission-presets";
import { innLookupRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/organization/legal-profile { inn? }
 *
 * Обновить снимок ЕГРЮЛ/ЕГРИП организации по ИНН (кнопка «Обновить из
 * ЕГРЮЛ» в настройках и автозаполнение). Без `inn` в теле берём ИНН,
 * сохранённый у организации. Ответ: { ok: true, profile } или
 * { ok: false, error }.
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasCapability(auth.session.user, "admin.full")) {
    return NextResponse.json({ ok: false, error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(auth.session);
  if (!innLookupRateLimiter.consume(`legal:${organizationId}`)) {
    return NextResponse.json(
      { ok: false, error: "Слишком много запросов. Подождите минуту." },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => null)) as { inn?: unknown } | null;
  let inn = typeof body?.inn === "string" ? innDigits(body.inn) : "";
  if (!inn) {
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { inn: true },
    });
    inn = innDigits(org?.inn);
  }
  if (!isValidInn(inn)) {
    return NextResponse.json(
      { ok: false, error: "Укажите ИНН из 10 или 12 цифр" },
      { status: 400 },
    );
  }
  if (!process.env.DADATA_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "Сервис ЕГРЮЛ не настроен — заполните данные вручную" },
      { status: 503 },
    );
  }

  const profile = await refreshOrganizationLegalProfile(organizationId, inn);
  if (!profile) {
    return NextResponse.json(
      { ok: false, error: "Организация с таким ИНН не найдена" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, profile });
}
