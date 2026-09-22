import { NextResponse, type NextRequest } from "next/server";
import { decode } from "next-auth/jwt";
import {
  CUSTOM_SESSION_COOKIE,
  LEGACY_SESSION_COOKIES,
} from "@/lib/auth-cookies";
import { canAccessWebPath, hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  MINI_SHELL_COOKIE,
  MINI_SHELL_VALUE,
  isMiniPath,
  isMiniShellValue,
  miniShellSignInHref,
} from "@/lib/mini-shell-cookie";
import {
  evaluatePartnerRequest,
  parsePartnerAccessClaim,
  type PartnerAccessClaim,
} from "@/lib/partners/access-guard";
import {
  PARTNER_HEADER_METHOD,
  PARTNER_HEADER_PARTNER_ID,
  PARTNER_HEADER_PATH,
  PARTNER_REQUEST_HEADERS,
} from "@/lib/partners/request-context";

/**
 * Прокидываем в обработчики метод/путь запроса и id партнёра. Клиентские
 * значения этих заголовков всегда затираются — им доверяет getServerSession.
 */
function withRequestContext(
  req: NextRequest,
  claim: PartnerAccessClaim | null,
): NextResponse {
  const headers = new Headers(req.headers);
  for (const name of PARTNER_REQUEST_HEADERS) headers.delete(name);
  headers.set(PARTNER_HEADER_METHOD, req.method);
  headers.set(PARTNER_HEADER_PATH, req.nextUrl.pathname);
  if (claim) headers.set(PARTNER_HEADER_PARTNER_ID, claim.partnerId);
  const res = NextResponse.next({ request: { headers } });
  markMiniShell(req, res);
  // Страницы кабинета не кэшируем (раньше это делал отдельный корневой
  // middleware.ts, который в dev перекрывал этот файл целиком — и guard
  // партнёра там не работал).
  const { pathname } = req.nextUrl;
  // `/og/*` и `/og-default` — картинки для соцсетей без расширения в пути:
  // маршруты сами ставят публичный кэш, иначе превью генерировалось бы
  // заново на каждый показ ссылки.
  const isPublicImageRoute = pathname.startsWith("/og/") || pathname === "/og-default";
  const isAppPage =
    !pathname.startsWith("/_next") &&
    !pathname.startsWith("/api") &&
    !pathname.startsWith("/favicon") &&
    !isPublicImageRoute &&
    !pathname.includes(".");
  if (isAppPage) {
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    res.headers.set("Pragma", "no-cache");
    res.headers.set("Expires", "0");
  }
  return res;
}

/**
 * Включить режим оболочки для адресов самого мини-приложения.
 *
 * Правило то же, что у клиента (`shouldSetMiniShell`: путь `/mini/*` —
 * значит человек в приложении), но поставить куку обязан сервер.
 * Экраны `/mini/*`, которые теперь просто перекидывают на страницу
 * кабинета (`/mini/journals/hygiene` → `/journals/hygiene`), делают это
 * серверным редиректом — клиентский код там не успевает выполниться, и
 * без этой куки человек, пришедший по ссылке из бота первый раз,
 * получил бы внутри Telegram широкий хром сайта.
 */
function markMiniShell(req: NextRequest, res: NextResponse): void {
  const { pathname } = req.nextUrl;
  if (!isMiniPath(pathname)) return;
  if (isMiniShellValue(req.cookies.get(MINI_SHELL_COOKIE)?.value)) return;

  // Telegram открывает мини-приложение во фрейме: на https кука доедет
  // только с `SameSite=None; Secure` (см. lib/mini-shell-cookie.ts).
  const secure =
    (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol).startsWith(
      "https"
    );
  res.cookies.set({
    name: MINI_SHELL_COOKIE,
    value: MINI_SHELL_VALUE,
    path: "/",
    sameSite: secure ? "none" : "lax",
    secure,
  });
}

function partnerDenied(req: NextRequest, reason: string): NextResponse {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: reason, code: "partner_access_denied" },
      { status: 403 },
    );
  }
  const url = new URL("/partner/denied", req.url);
  url.searchParams.set("reason", reason);
  url.searchParams.set("from", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

const STAFF_RESTRICTED_WEB_PREFIXES = [
  "/dashboard",
  "/settings",
  "/reports",
  "/plans",
  "/changes",
  "/losses",
  "/batches",
  "/competencies",
  "/capa",
  "/sanpin",
] as const;

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isStaffRestrictedWebPath(pathname: string): boolean {
  return STAFF_RESTRICTED_WEB_PREFIXES.some((prefix) =>
    matchesPrefix(pathname, prefix)
  );
}

/**
 * Global proxy (Next 16: файл `proxy.ts`, раньше — `middleware.ts`;
 * на dev-сервере устаревшая конвенция не выполнялась вовсе, и guard
 * партнёра там не срабатывал).
 *
 * 1. `/root/*` is the platform superadmin area. Non-root requests get a plain
 *    404 so customer users can't even probe for the URL's existence (we
 *    intentionally don't redirect — a 302 back to /dashboard would reveal the
 *    route exists). Anonymous requests also 404: if there's no session, they
 *    aren't root either, and we still don't want to leak.
 *
 * 2. `/api/root/*` is the matching API surface; same 404 policy.
 *
 * We decode the JWT manually (not via getToken) so we can read the custom
 * cookie this project installed on top of NextAuth.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // www.wesetup.ru → wesetup.ru: один канонический адрес (SEO и cookies).
  // Host берём из заголовка запроса — за nginx `req.nextUrl` может быть localhost.
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  if (host.startsWith("www.")) {
    const url = new URL(`https://${host.slice(4)}${pathname}${req.nextUrl.search}`);
    return NextResponse.redirect(url, 308);
  }

  // Трейлинг-слеш обрабатываем вручную: автоматический редирект
  // выключен в next.config.ts (`skipTrailingSlashRedirect`), потому что
  // он срабатывал раньше middleware и ломал приём оплаты.
  //
  // ResultURL Робокассы прописан в кабинете как
  // `https://wesetup.ru/payment/`. На редирект 308 Робокасса не идёт —
  // уведомления терялись, и оплаченные заказы навсегда оставались
  // в статусе pending. Этот путь переписываем без редиректа, всем
  // остальным сохраняем прежнее поведение.
  if (pathname === "/payment/") {
    const url = req.nextUrl.clone();
    url.pathname = "/payment";
    return NextResponse.rewrite(url);
  }
  if (pathname.length > 1 && pathname.endsWith("/")) {
    // URL строим из req.url, а не из nextUrl.clone(): клон сохраняет
    // исходный путь со слешем, и редирект зацикливается сам на себя.
    const url = new URL(req.url);
    url.pathname = pathname.replace(/\/+$/, "");
    return NextResponse.redirect(url, 308);
  }

  const rawToken =
    req.cookies.get(CUSTOM_SESSION_COOKIE)?.value ??
    LEGACY_SESSION_COOKIES.map((name) => req.cookies.get(name)?.value).find(
      Boolean
    );

  // Оболочка мини-приложения: страницы кабинета открыты в телефоне.
  // Права она НЕ меняет — меняет только, куда вести отказ: на сайте это
  // `/login` и `/journals`, в приложении — его собственный главный экран.
  const miniShell = isMiniShellValue(req.cookies.get(MINI_SHELL_COOKIE)?.value);

  if (!rawToken) {
    if (miniShell && isStaffRestrictedWebPath(pathname)) {
      return NextResponse.redirect(
        new URL(miniShellSignInHref(pathname), req.url)
      );
    }
    if (pathname.startsWith("/root") || pathname.startsWith("/api/root")) {
      return NextResponse.rewrite(new URL("/404", req.url), { status: 404 });
    }
    return withRequestContext(req, null);
  }

  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    if (pathname.startsWith("/root") || pathname.startsWith("/api/root")) {
      return NextResponse.rewrite(new URL("/404", req.url), { status: 404 });
    }
    return withRequestContext(req, null);
  }

  const token = await decode({ token: rawToken, secret }).catch(() => null);
  if (pathname.startsWith("/root") || pathname.startsWith("/api/root")) {
    if (!token || token.isRoot !== true) {
      return NextResponse.rewrite(new URL("/404", req.url), { status: 404 });
    }
    return withRequestContext(req, null);
  }

  // Партнёр в кабинете клиента: claim действует, только пока активная
  // организация совпадает с организацией из claim'а. Уровень «просмотр»
  // режет мутации здесь (первый слой) и в getServerSession (второй —
  // с живым уровнем из БД).
  const rawClaim = token ? parsePartnerAccessClaim(token.partnerAccess) : null;
  const claim =
    rawClaim &&
    typeof token?.activeOrganizationId === "string" &&
    token.activeOrganizationId === rawClaim.organizationId
      ? rawClaim
      : null;
  if (claim) {
    const verdict = evaluatePartnerRequest({
      method: req.method,
      pathname,
      claim,
    });
    if (!verdict.allow) return partnerDenied(req, verdict.reason);
  }

  if (!token || !isStaffRestrictedWebPath(pathname)) {
    return withRequestContext(req, claim);
  }

  const actor = {
    // В кабинете клиента партнёр работает как руководство независимо
    // от своей роли в домашней организации.
    // «Разрешение менять настройки» — как руководство (2026-09-22).
    role: claim || token.canManageSettings === true ? "owner" : typeof token.role === "string" ? token.role : null,
    isRoot: token.isRoot === true,
  };
  if (hasFullWorkspaceAccess(actor) || canAccessWebPath(actor, pathname)) {
    return withRequestContext(req, claim);
  }

  // В приложении «нет прав на раздел» — это возврат на его главный
  // экран: списка журналов сайта там нет, и человек упёрся бы в чужой хром.
  return NextResponse.redirect(
    new URL(miniShell ? "/mini" : "/journals", req.url)
  );
}

export const config = {
  // Next.js 16 path-to-regexp misses the bare `/root` and `/api/root/<handler>`
  // segments no matter how we list them (`/root`, `/root/:path*`, `/root{/:path*}`
  // all leak anon probes to the page layer, which then 307s to /login and
  // leaks the section's existence). Catch every request that isn't a Next.js
  // internal asset instead, and let the early `startsWith` check above exit
  // in a single string-compare for the 99.9% of traffic that isn't `/root`.
  matcher: ["/((?!_next/|favicon\\.ico$).*)"],
};
