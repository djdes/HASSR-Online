import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { getSessionVersion } from "@/lib/session-version";
import { expireLegacyAuxCookies, setSessionCookie } from "@/lib/auth-cookies";

/**
 * Выдача сессии в обход NextAuth.
 *
 * Проект минтит JWT вручную (вход по паролю, телефону, личному QR,
 * приглашению, мгновенная регистрация, киоск…) и кладёт его в ту же
 * куку, что ставит next-auth (`sessionCookieName`), а прочие имена
 * сессии гасит (`setSessionCookie`, `lib/auth-cookies.ts`). Раньше токен
 * раскладывался ещё и по легаси-именам — и `signOut` next-auth, гасивший
 * одну свою куку, оставлял человека в аккаунте.
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

  // Прочие имена сессии гасятся: иначе можно унаследовать чужую сессию,
  // оставшуюся в браузере (например, «Войти как» ROOT'а).
  setSessionCookie(response.cookies, token, MAX_AGE);
  expireLegacyAuxCookies(response.cookies);
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

  setSessionCookie(response.cookies, token, maxAge);
  expireLegacyAuxCookies(response.cookies);
  return response;
}
