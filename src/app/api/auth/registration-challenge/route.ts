import { NextResponse } from "next/server";
import { issueRegistrationChallenge } from "@/lib/registration-antibot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Тихо выдаёт форме подписанную отметку времени — невидимая проверка от ботов. */
export function GET() {
  const challenge = issueRegistrationChallenge();
  return NextResponse.json(
    challenge ?? { error: "Проверка перед регистрацией временно недоступна. Попробуйте позже." },
    { status: challenge ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
