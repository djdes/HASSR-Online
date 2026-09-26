import { cookies } from "next/headers";
import { decode, encode } from "next-auth/jwt";
import { sessionCookieReadOrder, setSessionCookie } from "@/lib/auth-cookies";

/**
 * Правка claim'ов в уже выданном session-cookie.
 *
 * Через `update()` из NextAuth v4 на Next.js 16 это не работает надёжно:
 * вызов возвращает успех, но cookie не всегда попадает в ответ, и
 * следующий `getServerSession()` видит старый JWT. Поэтому пишем cookie
 * сами — тем же секретом и под тем же именем, что и вход.
 *
 * Про несколько cookie. Читатели (`lib/server-session.ts`, `proxy.ts`)
 * берут первое имя в порядке `sessionCookieReadOrder`: актуальное имя
 * сессии, прочие — только если его нет. Пока правилась одна cookie из
 * нескольких, impersonation не работал вовсе: claim уходил в одно имя,
 * а читатель брал другое. Поэтому свежий токен кладётся под актуальное
 * имя, а остальные гасятся (`setSessionCookie`) — читатель гарантированно
 * увидит правку.
 *
 * Общий код для двух сценариев смены организации: ROOT-impersonation
 * (`actingAsOrganizationId`) и переключения между своими организациями
 * (`activeOrganizationId`). Проверку прав делает вызывающий — здесь
 * только механика cookie.
 */

const MAX_AGE_SEC = 365 * 24 * 60 * 60;

/**
 * Имя cookie, из которого читатель возьмёт токен. Порядок тот же, что у
 * `lib/server-session.ts` и `proxy.ts` (`sessionCookieReadOrder`) —
 * расходиться им нельзя.
 */
export function findSessionCookieName(
  has: (name: string) => boolean,
  production?: boolean,
): string | null {
  return sessionCookieReadOrder(production).find((name) => has(name)) ?? null;
}

export type RewriteResult = { ok: true } | { ok: false; reason: string };

export async function rewriteSessionClaims(
  patch: Record<string, unknown>,
  /** Проверка перед записью: получает расшифрованный токен. */
  guard?: (token: Record<string, unknown>) => string | null
): Promise<RewriteResult> {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) return { ok: false, reason: "NEXTAUTH_SECRET не задан" };

  const cookieStore = await cookies();
  const has = (name: string) => Boolean(cookieStore.get(name)?.value);

  const sourceName = findSessionCookieName(has);
  if (!sourceName) return { ok: false, reason: "Cookie сессии не найден" };
  const current = cookieStore.get(sourceName)?.value as string;

  let decoded: Record<string, unknown> | null = null;
  try {
    decoded = (await decode({ token: current, secret })) as Record<
      string,
      unknown
    > | null;
  } catch {
    return { ok: false, reason: "Не удалось декодировать JWT" };
  }
  if (!decoded) return { ok: false, reason: "JWT пустой" };

  const denied = guard?.(decoded);
  if (denied) return { ok: false, reason: denied };

  Object.assign(decoded, patch);

  // Смена организации меняет и вид организации: мастер-кабинет справочников
  // proxy пускает только в /master (lib/master-directory-access.ts).
  try {
    const { readOrgKind } = await import("@/lib/master-directory");
    const { tokenActiveOrgId } = await import("@/lib/master-directory-access");
    decoded.orgKind = await readOrgKind(tokenActiveOrgId(decoded));
  } catch {
    /* оставляем прежнее значение */
  }

  const fresh = await encode({
    token: decoded as Parameters<typeof encode>[0]["token"],
    secret,
    maxAge: MAX_AGE_SEC,
  });

  // Под актуальное имя; прочие имена (сессия, выданная до перехода на одно
  // имя) гасятся — иначе одна из них осталась бы со старым токеном.
  setSessionCookie(cookieStore, fresh, MAX_AGE_SEC);

  return { ok: true };
}
