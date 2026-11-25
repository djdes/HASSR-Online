import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { QualityGateError } from "@/lib/smm/service.server";

import { MaxChannelError, explainMaxFailure } from "./channel.server";

/** Общий ответ об ошибке для маршрутов ROOT → «Канал MAX». */
export function maxChannelFailure(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message ?? "Проверьте поля поста" }, { status: 400 });
  }
  if (error instanceof QualityGateError) {
    // B02: клиент покажет отчёт и спросит подтверждение.
    return NextResponse.json({ error: error.message, quality: error.report, gate: true }, { status: 422 });
  }
  if (error instanceof MaxChannelError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // notFound()/redirect() из requireRoot — пробрасываем Next.js.
  if (error && typeof error === "object" && "digest" in error) throw error;
  return NextResponse.json({ error: explainMaxFailure(error) }, { status: 502 });
}
