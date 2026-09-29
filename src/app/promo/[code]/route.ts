import { authOptions } from "@/lib/auth";
import { getActiveOrgId, isImpersonating } from "@/lib/auth-helpers";
import { readActiveLifetimeDiscount, resolveCheckoutTarget } from "@/lib/promo/checkout";
import { promoLinkStatus } from "@/lib/promo/personal-codes";
import {
  linkSphere,
  PROMO_COOKIE,
  PROMO_COOKIE_MAX_AGE_SEC,
  promoLinkRedirect,
  type PromoLinkViewer,
} from "@/lib/promo/personal-link";
import { normalizePromoCode } from "@/lib/promo/rules";
import { relativeRedirect } from "@/lib/relative-redirect";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getServerSession } from "@/lib/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/promo/<CODE>?s=<sphere>` — ссылка и QR с промокодом из КП и рассылки
 * (контракт адреса заморожен — на него уже ссылаются).
 *
 * Код действует → cookie `wesetup.promo` на 30 дней и:
 *   - руководитель в кабинете → /settings/subscription?promo=CODE;
 *   - другой вошедший (сотрудник) → /order?plan=monthly&promo=CODE;
 *   - гость → регистрация со сферой, после неё — тариф с кодом.
 * Не действует или неизвестен → /promo?code=CODE («Промокод больше не
 * действует» со ссылкой на тарифы). Исключение: у руководителя этот код
 * уже работает как скидка навсегда — ведём на тариф, там это видно.
 *
 * Кому выдан персональный код, здесь не проверяем: плательщик ещё
 * неизвестен — это решит оплата («выдан другой организации»).
 */
export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code: param } = await ctx.params;
  // Next 16 отдаёт params нераскодированными.
  let raw = param;
  try {
    raw = decodeURIComponent(param);
  } catch {
    /* битая последовательность — проверим как есть */
  }
  const code = normalizePromoCode(raw).slice(0, 64);
  const sphere = linkSphere(new URL(request.url).searchParams.get("s"));

  const session = await getServerSession(authOptions).catch(() => null);
  const viewer: PromoLinkViewer = !session?.user
    ? "guest"
    : hasFullWorkspaceAccess(session.user) && !isImpersonating(session)
      ? "manager"
      : "member";

  const status = await promoLinkStatus(code);
  if (!status.ok) {
    // Свой код, исчерпанный первой оплатой, у руководителя уже работает
    // как скидка навсегда — это не «больше не действует».
    if (viewer === "manager" && session?.user && status.reason === "exhausted" && status.lifetime) {
      const target = await resolveCheckoutTarget({
        organizationId: getActiveOrgId(session),
        email: session.user.email ?? null,
      }).catch(() => null);
      const lifetime = target?.accountId ? await readActiveLifetimeDiscount(target.accountId).catch(() => null) : null;
      if (lifetime?.code === code) {
        const location = promoLinkRedirect(code, sphere, viewer);
        console.info(`[promo] link opened code=${code} viewer=manager: already bound as lifetime → ${location}`);
        return relativeRedirect(location);
      }
    }
    console.info(`[promo] link rejected code=${code} reason=${status.reason} viewer=${viewer}`);
    return relativeRedirect(`/promo?code=${encodeURIComponent(code)}`);
  }

  const location = promoLinkRedirect(code, sphere, viewer);
  console.info(
    `[promo] link opened code=${code} sphere=${sphere ?? "-"} viewer=${viewer}` +
      `${session?.user?.id ? ` user=${session.user.id}` : ""} → ${location}`
  );
  const response = relativeRedirect(location);
  // Код ждёт оплату и после регистрации, и если человек вернётся позже.
  // httpOnly не нужен: в cookie только сам код, не секрет.
  response.cookies.set({
    name: PROMO_COOKIE,
    value: code,
    maxAge: PROMO_COOKIE_MAX_AGE_SEC,
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
