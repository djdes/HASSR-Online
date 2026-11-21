import { createSentryTunnelRoute } from "@sentry/nextjs/tunnel";

import { SENTRY_DSN } from "@/lib/sentry-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/monitoring — туннель Sentry: браузер шлёт ошибки на свой домен (их не режут блокировщики
 * рекламы, IP посетителя не уходит в Sentry), сервер пересылает в Sentry только тело события и только
 * для нашего DSN (чужой — 403). Без входа: ошибки бывают и до входа.
 */
export const { POST } = createSentryTunnelRoute({ allowedDsns: [SENTRY_DSN] });
