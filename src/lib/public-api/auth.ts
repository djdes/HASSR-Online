import { db } from "@/lib/db";
import { isLocale } from "@/i18n/locales";
import { publicApiRateLimiter } from "@/lib/rate-limit";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import type { ApiCallContext, ApiVia } from "./context";
import { hashApiKey, isApiKeyAccess, looksLikeApiKey, looksLikeLegacyOrgToken } from "./keys";

/**
 * Проверка персонального ключа для MCP и REST API v1.
 *
 * Ключ действует с правами владельца в организации, где выпущен. Права
 * перепроверяются на каждый запрос: уволили, архивировали, понизили до
 * линейной роли или убрали из организации — ключ перестаёт работать
 * сразу, без ручного отзыва.
 */

export type ApiAuthResult =
  | { ok: true; ctx: ApiCallContext }
  | { ok: false; status: 401 | 403 | 429; error: string; retryAfterSec?: number };

const TOUCH_INTERVAL_MS = 60_000;

export function publicBaseUrl(): string {
  return (process.env.NEXTAUTH_URL || "https://wesetup.ru").replace(/\/+$/, "");
}

export function extractApiKey(request: Request, pathKey?: string): string | null {
  if (pathKey) return pathKey.trim();
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

const NOT_FOUND = "Ключ не найден или отозван.";

export async function authenticateApiKey(
  request: Request,
  opts: { via: ApiVia; pathKey?: string; now?: Date }
): Promise<ApiAuthResult> {
  const secret = extractApiKey(request, opts.pathKey);
  if (!secret) {
    return {
      ok: false,
      status: 401,
      error:
        "Нужен ключ WeSetup: заголовок Authorization: Bearer wsk_… или ссылка с ключом со страницы «ИИ-ассистенты и API».",
    };
  }
  if (!looksLikeApiKey(secret)) {
    if (looksLikeLegacyOrgToken(secret)) {
      return {
        ok: false,
        status: 401,
        error:
          "Это ключ интеграций для /api/external. Для ИИ-ассистента создайте персональный ключ на странице «ИИ-ассистенты и API».",
      };
    }
    return { ok: false, status: 401, error: NOT_FOUND };
  }

  const key = await db.apiAccessKey.findUnique({
    where: { tokenHash: hashApiKey(secret) },
    select: {
      id: true,
      name: true,
      access: true,
      organizationId: true,
      revokedAt: true,
      user: {
        select: { id: true, name: true, role: true, isActive: true, archivedAt: true, organizationId: true, locale: true },
      },
      organization: { select: { id: true, name: true, timezone: true } },
    },
  });
  if (!key || key.revokedAt) return { ok: false, status: 401, error: NOT_FOUND };

  const { user, organization } = key;
  if (!user.isActive || user.archivedAt) {
    return { ok: false, status: 403, error: "Владелец ключа отключён — ключ больше не действует." };
  }

  let role = user.role;
  if (user.organizationId !== key.organizationId) {
    const member = await db.organizationMember.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: key.organizationId } },
      select: { role: true },
    });
    if (!member) {
      return { ok: false, status: 403, error: "Владелец ключа больше не работает в этой организации." };
    }
    role = member.role;
  }
  if (!hasFullWorkspaceAccess({ role, isRoot: false })) {
    return {
      ok: false,
      status: 403,
      error: "У владельца ключа больше нет прав руководителя — создайте новый ключ.",
    };
  }

  if (!publicApiRateLimiter.consume(key.id)) {
    return {
      ok: false,
      status: 429,
      error: "Слишком много запросов — подождите минуту.",
      retryAfterSec: Math.max(1, Math.ceil(publicApiRateLimiter.remainingMs(key.id) / 1000)),
    };
  }

  const now = opts.now ?? new Date();
  await db.apiAccessKey
    .updateMany({
      where: {
        id: key.id,
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - TOUCH_INTERVAL_MS) } }],
      },
      data: { lastUsedAt: now, lastUsedVia: opts.via },
    })
    .catch((error) => console.error("[public-api] touch lastUsedAt failed", error));

  return {
    ok: true,
    ctx: {
      keyId: key.id,
      keyName: key.name,
      access: isApiKeyAccess(key.access) ? key.access : "read",
      via: opts.via,
      orgId: organization.id,
      orgName: organization.name,
      timezone: organization.timezone ?? null,
      actor: { id: user.id, role, isRoot: false, name: user.name },
      locale: isLocale(user.locale) ? user.locale : "ru",
      baseUrl: publicBaseUrl(),
    },
  };
}
