import { NextResponse } from "next/server";
import { blankChallengeConfig } from "@/lib/blank-recaptcha.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const config = blankChallengeConfig();
  return NextResponse.json(
    config ?? { error: "Проверка перед скачиванием временно недоступна. Попробуйте позже." },
    { status: config ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
