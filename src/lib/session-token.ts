import { cookies } from "next/headers";
import { decode, encode } from "next-auth/jwt";
import {
  ALL_SESSION_COOKIES,
  CUSTOM_SESSION_COOKIE,
  LEGACY_SESSION_COOKIES,
} from "@/lib/auth-cookies";

/**
 * Правка claim'ов в уже выданном session-cookie.
 *
 * Через `update()` из NextAuth v4 на Next.js 16 это не работает надёжно:
 * вызов возвращает успех, но cookie не всегда попадает в ответ, и
 * следующий `getServerSession()` видит старый JWT. Поэтому пишем cookie
 * сами — тем же секретом и теми же именами, что и вход.
 *
 * ВАЖНО про несколько cookie. `issueSession` при входе кладёт токен
 * СРАЗУ в несколько имён: основное `haccp-online.session-token` и
 * легаси-имена (совместимость со старыми вкладками и мобильными
 * клиентами). Читатель — `lib/server-session.ts` и middleware — берёт
 * первое существующее в порядке `CUSTOM → LEGACY`.
 *
 * Пока правилось только одно имя, impersonation не работал вовсе:
 * claim уходил в `__Secure-…`, а читатель брал основную cookie, которая
 * оставалась со старым токеном. Ошибки при этом не было — «Войти как»
 * просто не давало эффекта. Поэтому переписываем ВСЕ присутствующие
 * cookie сессии, а не одну.
 *
 * Общий код для двух сценариев смены организации: ROOT-impersonation
 * (`actingAsOrganizationId`) и переключения между своими организациями
 * (`activeOrganizationId`). Проверку прав делает вызывающий — здесь
 * только механика cookie.
 */

const MAX_AGE_SEC = 365 * 24 * 60 * 60;

/**
 * Порядок, в котором читатель ищет токен. Совпадает с
 * `lib/server-session.ts` и `middleware.ts` — расходиться им нельзя.
 */
const READ_ORDER = [CUSTOM_SESSION_COOKIE, ...LEGACY_SESSION_COOKIES] as const;

/** Имя cookie, из которого читатель возьмёт токен. */
export function findSessionCookieName(
  has: (name: string) => boolean
): string | null {
  return READ_ORDER.find((name) => has(name)) ?? null;
}

/**
 * Все имена сессии, которые сейчас есть в запросе.
 *
 * Переписать нужно каждое: оставшаяся со старым токеном cookie рано или
 * поздно окажется первой в порядке чтения и отменит правку.
 */
export function listPresentSessionCookies(
  has: (name: string) => boolean
): string[] {
  return ALL_SESSION_COOKIES.filter((name) => has(name));
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

  for (const name of listPresentSessionCookies(has)) {
    cookieStore.set(name, fresh, {
      httpOnly: true,
      // Имя с префиксом `__Secure-` браузер принимает только с secure:true;
      // остальным флаг ставим по окружению, как это делает вход.
      secure:
        name.startsWith("__Secure-") || process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE_SEC,
    });
  }

  return { ok: true };
}
