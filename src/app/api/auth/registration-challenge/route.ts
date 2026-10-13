import { NextResponse } from "next/server";
import { registrationChallengeConfig } from "@/lib/registration-antibot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const config = registrationChallengeConfig();
  return NextResponse.json(
    config ?? { error: "Проверка перед регистрацией временно недоступна. Попробуйте позже." },
    { status: config ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
