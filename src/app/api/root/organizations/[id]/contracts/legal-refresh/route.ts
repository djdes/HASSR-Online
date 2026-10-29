import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { isValidInn } from "@/lib/inn";
import { refreshOrganizationLegalProfile } from "@/lib/org-legal-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — «Обновить из ЕГРЮЛ»: снимок DaData по ИНН организации. Правки
 * «Реквизитов» клиента не трогаются (они поверх снимка).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await params;
  const org = await db.organization.findUnique({ where: { id }, select: { inn: true } });
  if (!org) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  const inn = (org.inn ?? "").replace(/\D/g, "");
  if (!isValidInn(inn)) return NextResponse.json({ error: "У организации нет корректного ИНН" }, { status: 409 });
  const profile = await refreshOrganizationLegalProfile(id, inn);
  if (!profile) {
    return NextResponse.json(
      { error: process.env.DADATA_API_KEY ? "ЕГРЮЛ сейчас не ответил — попробуйте позже" : "Подсказки по ИНН (DaData) на сервере не подключены" },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, name: profile.nameShort ?? profile.nameFull });
}
