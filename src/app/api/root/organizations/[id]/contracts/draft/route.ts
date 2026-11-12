import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { CONTRACT_DRAFT_MAX_BYTES } from "@/lib/contracts/draft";
import { saveContractDraft } from "@/lib/contracts/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/root/organizations/[id]/contracts/draft — автосохранение формы
 * договора (`{ form, text }`): введённые реквизиты, тариф и свой текст не
 * теряются после перезагрузки. Сохраняется как есть, при чтении фильтруется
 * (`mergeContractDraft`). DELETE — стереть черновик.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await params;
  const raw = await request.text();
  if (raw.length > CONTRACT_DRAFT_MAX_BYTES) return NextResponse.json({ error: "Черновик слишком большой" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || !("form" in body)) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  const { form, text } = body as { form: unknown; text?: unknown };
  try {
    await saveContractDraft(id, { form, text: text ?? null });
  } catch {
    return NextResponse.json({ error: "Организация не найдена" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRoot();
  const { id } = await params;
  await saveContractDraft(id, null).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
