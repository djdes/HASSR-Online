import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { getSessionVersion } from "@/lib/session-version";
import {
  ALL_SESSION_COOKIES,
  CUSTOM_SESSION_COOKIE,
  LEGACY_SESSION_COOKIES,
  LEGACY_AUX_COOKIES,
} from "@/lib/auth-cookies";

/**
 * Выдача сессии в обход NextAuth.
 *
 * Проект минтит JWT вручную и кладёт его в собственную куку плюс
 * несколько легаси-имён (историческая совместимость со старыми
 * вкладками и мобильными клиентами). Логика жила только в
 * `/api/auth/login`; после появления мгновенной регистрации она нужна
 * в двух местах, поэтому вынесена сюда — чтобы поведение кук было
 * ровно одинаковым и не разъехалось при правках.
 */

const MAX_AGE = 365 * 24 * 60 * 60;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  isRoot?: boolean | null;
  permissionPreset?: string | null;
};

function appendSessionCookie(
  response: NextResponse,
  cookieName: string,
  token: string,
) {
  const expires = new Date(Date.now() + MAX_AGE * 1000).toUTCString();
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  response.headers.append(
    "Set-Cookie",
    `${cookieName}=${token}; Path=/; Expires=${expires}; Max-Age=${MAX_AGE}; HttpOnly; SameSite=Lax${secure}`,
  );
}

function appendExpiredCookie(response: NextResponse, cookieName: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  response.headers.append(
    "Set-Cookie",
    `${cookieName}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure}`,
  );
}

/**
 * Гасим все посторонние куки сессии. Важно при входе: иначе можно
 * унаследовать чужую impersonation-сессию, оставшуюся от ROOT'а.
 */
export function clearLegacyCookies(response: NextResponse) {
  for (const cookieName of LEGACY_SESSION_COOKIES) {
    appendExpiredCookie(response, cookieName);
  }

  for (const cookieName of [...ALL_SESSION_COOKIES, ...LEGACY_AUX_COOKIES]) {
    if (cookieName === CUSTOM_SESSION_COOKIE) continue;
    if (LEGACY_SESSION_COOKIES.includes(cookieName)) continue;
    response.cookies.set(cookieName, "", {
      path: "/",
      expires: new Date(0),
      httpOnly: cookieName.includes("session-token"),
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }
}

/**
 * Кладёт свежую сессию в переданный ответ и возвращает его же.
 * Бросает, если не задан секрет — молча пускать без сессии нельзя.
 */
export async function issueSession(
  response: NextResponse,
  user: SessionUser,
  organizationName: string,
): Promise<NextResponse> {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is not configured");
  }

  // «Разрешение менять настройки» (2026-09-22) — в токене, чтобы proxy
  // пускал в настройки. При смене галки сессии сотрудника сбрасываются
  // (bumpSessionVersion в /api/users/[id]), и новый вход берёт свежее.
  const { db } = await import("@/lib/db");
  const flags = await db.user.findUnique({ where: { id: user.id }, select: { canManageSettings: true } }).catch(() => null);
  // Мастер-кабинет справочников: proxy пускает такую сессию только в /master.
  const { readOrgKind } = await import("@/lib/master-directory");
  const orgKind = await readOrgKind(user.organizationId).catch(() => "regular" as const);

  const token = await encode({
    secret,
    maxAge: MAX_AGE,
    token: {
      canManageSettings: flags?.canManageSettings === true,
      orgKind,
      sub: user.id,
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      organizationName,
      isRoot: user.isRoot === true,
      actingAsOrganizationId: null,
      permissionPreset: user.permissionPreset ?? null,
      sv: await getSessionVersion(user.id),
    },
  });

  clearLegacyCookies(response);
  response.cookies.set(CUSTOM_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
  for (const cookieName of LEGACY_SESSION_COOKIES) {
    appendSessionCookie(response, cookieName, token);
  }

  return response;
}

/** Потолок киоск-сессии: 12 часов, дальше — обязательный повторный вход по ПИН. */
export const KIOSK_SESSION_MAX_AGE = 12 * 60 * 60;

/**
 * Короткая сессия сотрудника на общем планшете (киоске).
 *
 * Отличие от `issueSession`: клеймы `kiosk/deviceId/lockAt` и короткий срок.
 * `lockAt` (абсолютные мс) читает `server-session`: после него сессия
 * считается заблокированной, и киоск требует ПИН заново. Продлевается
 * heartbeat'ом при активности. Так «повар второй смены» не допишет журнал
 * под именем первого, забывшего выйти.
 */
export async function issueKioskSession(
  response: NextResponse,
  user: SessionUser,
  organizationName: string,
  opts: { deviceId: string; lockAt: number; ttlSeconds?: number },
): Promise<NextResponse> {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is not configured");
  }

  const maxAge = Math.min(opts.ttlSeconds ?? KIOSK_SESSION_MAX_AGE, KIOSK_SESSION_MAX_AGE);
  const token = await encode({
    secret,
    maxAge,
    token: {
      sub: user.id,
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      organizationName,
      isRoot: user.isRoot === true,
      actingAsOrganizationId: null,
      permissionPreset: user.permissionPreset ?? null,
      sv: await getSessionVersion(user.id),
      kiosk: true,
      deviceId: opts.deviceId,
      lockAt: opts.lockAt,
    },
  });

  clearLegacyCookies(response);
  response.cookies.set(CUSTOM_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge,
    secure: process.env.NODE_ENV === "production",
  });
  for (const cookieName of LEGACY_SESSION_COOKIES) {
    appendSessionCookie(response, cookieName, token);
  }

  return response;
}
