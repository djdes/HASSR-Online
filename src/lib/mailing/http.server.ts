import { NextResponse } from "next/server";

import { MailingError } from "./campaigns.server";

/** Понятная ошибка ROOT — её текст; остальное — 500 и запись в лог. */
export function mailingErrorResponse(error: unknown, scope: string): NextResponse {
  if (error instanceof MailingError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`[mailing] ${scope} failed`, error);
  return NextResponse.json({ error: "Не получилось — ошибка на сервере, подробности в логе" }, { status: 500 });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export function intParam(value: string | null, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}
