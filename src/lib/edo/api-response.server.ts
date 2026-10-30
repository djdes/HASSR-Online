import { NextResponse } from "next/server";

import { EdoServiceError } from "./cabinet.server";

/**
 * Ответ API ЭДО на ошибку: ошибка сценария — её статус и текст для человека; прочее — 500 с общим
 * текстом (подробности только в логе сервера: в них могут быть данные запроса к Saby).
 */
export function edoErrorResponse(e: unknown, where: string): NextResponse {
  if (e instanceof EdoServiceError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(`[edo] ${where}:`, e);
  return NextResponse.json({ error: "Не удалось выполнить действие с ЭДО — попробуйте ещё раз" }, { status: 500 });
}
