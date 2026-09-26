import type { NextAuthOptions, Session } from "next-auth";
import { decode } from "next-auth/jwt";
import { cookies } from "next/headers";
import { pickSessionCookie } from "@/lib/auth-cookies";
import { evaluatePartnerRequest } from "@/lib/partners/access-guard";
import { isSessionVersionCurrent } from "@/lib/session-version";
import { PARTNER_HEADER_METHOD, PARTNER_HEADER_PATH } from "@/lib/partners/request-context";

export async function getServerSession(
  options?: NextAuthOptions
): Promise<Session | null> {
  const cookieStore = await cookies();
  // Та же кука, что у proxy и next-auth (`useSession`): актуальное имя,
  // прочие — только если его нет (`lib/auth-cookies.ts`).
  const rawToken = pickSessionCookie((name) => cookieStore.get(name)?.value)?.value;

  if (!rawToken) {
    return null;
  }

  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    return null;
  }

  const token = await decode({
    token: rawToken,
    secret,
  });

  if (!token) {
    return null;
  }
  // Общий планшет: киоск-сессия живёт до `lockAt`. После бездействия (или
  // явного выхода) сервер её не видит — киоск требует ПИН заново, и «повар
  // второй смены» не допишет журнал под именем первого. Срабатывает только
  // при клейме `kiosk`; обычные сессии сюда не попадают.
  if (token.kiosk === true) {
    const lockAt = typeof token.lockAt === "number" ? token.lockAt : 0;
    if (!lockAt || lockAt < Date.now()) {
      return null;
    }
  }
  // Сессия отозвана («Завершить все сессии») — для сервера её нет.
  const tokenUserId = typeof token.id === "string" ? token.id : String(token.sub ?? "");
  if (!(await isSessionVersionCurrent(tokenUserId, token.sv))) {
    return null;
  }

  const session: Session = {
    user: {
      id: typeof token.id === "string" ? token.id : String(token.sub ?? ""),
      role: typeof token.role === "string" ? token.role : "",
      organizationId:
        typeof token.organizationId === "string" ? token.organizationId : "",
      organizationName:
        typeof token.organizationName === "string"
          ? token.organizationName
          : "",
      isRoot: token.isRoot === true,
      actingAsOrganizationId:
        typeof token.actingAsOrganizationId === "string"
          ? token.actingAsOrganizationId
          : null,
      permissionPreset:
        typeof token.permissionPreset === "string"
          ? token.permissionPreset
          : null,
      orgPresetOverrides: null,
      kioskDeviceId:
        token.kiosk === true && typeof token.deviceId === "string" ? token.deviceId : null,
      name: typeof token.name === "string" ? token.name : null,
      email: typeof token.email === "string" ? token.email : null,
      image: null,
    },
    expires:
      typeof token.exp === "number"
        ? new Date(token.exp * 1000).toISOString()
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  if (options?.callbacks?.session) {
    const callback = options.callbacks.session as (
      ...args: unknown[]
    ) => Promise<Session> | Session;
    const resolved = await callback({ session, token });
    return enforcePartnerWriteGuard(resolved);
  }

  return session;
}

/**
 * Второй рубеж для партнёра в кабинете клиента (первый — middleware по
 * claim'у из cookie). Здесь уровень уже перечитан из БД в session-callback:
 * если клиент только что понизил доступ до «просмотр», мутирующий запрос
 * не получит сессию вовсе — обработчик ответит 401/403.
 */
async function enforcePartnerWriteGuard(session: Session | null): Promise<Session | null> {
  const access = session?.user?.partnerAccess;
  if (!session || !access) return session;
  const { headers } = await import("next/headers");
  const requestHeaders = await headers().catch(() => null);
  if (!requestHeaders) return session;
  const method = requestHeaders.get(PARTNER_HEADER_METHOD);
  const pathname = requestHeaders.get(PARTNER_HEADER_PATH);
  if (!method || !pathname) return session;
  const verdict = evaluatePartnerRequest({
    method,
    pathname,
    claim: {
      partnerId: access.partnerId,
      organizationId: access.organizationId,
      level: access.level,
    },
  });
  return verdict.allow ? session : null;
}
