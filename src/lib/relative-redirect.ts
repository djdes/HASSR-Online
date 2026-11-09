import { NextResponse } from "next/server";

/**
 * Редирект с относительным `Location`.
 *
 * Зачем не `NextResponse.redirect(new URL(path, request.url))`. Next
 * собирает `request.url` обработчика из адреса, который слушает сам
 * сервер (`localhost:3002`), и `x-forwarded-proto`; Host запроса не
 * учитывается. Абсолютный адрес, собранный из `request.url`, уводит
 * человека на `https://localhost:3002/...`. Проверено на проде
 * 2026-09-11: так ломались вход по ссылке из письма, партнёрская и
 * реферальная регистрация; 2026-11-09 — «Панель платформы».
 * `NextResponse.redirect` всегда отдаёт абсолютный адрес — тест-сторож
 * в `relative-redirect.test.ts` не пускает его в обработчики.
 *
 * Относительный `Location` разрешён RFC 7231 и разворачивается браузером
 * от текущего адреса, поэтому работает и за прокси, и локально, и не
 * зависит от переменных окружения.
 *
 * Middleware (`src/proxy.ts`) этой проблемы не имеет — там `NextURL`
 * собирается из заголовков запроса, и его редиректы уже относительные.
 */
export function relativeRedirect(path: string, status: 307 | 308 = 307): NextResponse {
  return new NextResponse(null, {
    status,
    headers: { Location: safeInternalPath(path) },
  });
}

/**
 * Пропускает только путь внутри сайта.
 *
 * `//evil.com` — протокол-относительный адрес: браузер уведёт на чужой
 * домен, хотя строка начинается со слэша. Так же опасны `\\evil.com` и
 * `https://evil.com`. Всё, что не одиночный слэш в начале, заменяем на
 * корень: молча увести человека на чужой сайт хуже, чем на главную.
 */
export function safeInternalPath(path: string): string {
  const value = (path ?? "").trim();
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
