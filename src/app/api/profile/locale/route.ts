import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { isLocale, resolveLocale } from "@/i18n/locales";
import { SITE_LOCALE_COOKIE } from "@/i18n/site-locale";
import { translatorFor } from "@/i18n/translator";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const origin = request.headers.get("origin");
  const allowedOrigins = [new URL(request.url).origin];
  if (process.env.NEXTAUTH_URL) allowedOrigins.push(new URL(process.env.NEXTAUTH_URL).origin);
  if (origin && !allowedOrigins.includes(origin)) {
    return NextResponse.json({ code: "FORBIDDEN", error: "Forbidden" }, { status: 403 });
  }
  const session = await getServerSession(authOptions);
  const locale = resolveLocale({ authenticated: Boolean(session), userLocale: session?.user.locale, organizationLocale: session?.user.organizationLocale });
  const t = await translatorFor(locale);
  if (!session) {
    return NextResponse.json({ code: "UNAUTHORIZED", error: t("language.unauthorized") }, { status: 401 });
  }
  const body: unknown = await request.json().catch(() => null);
  const requested = body && typeof body === "object" && "locale" in body ? body.locale : undefined;
  if (!isLocale(requested)) {
    return NextResponse.json({ code: "INVALID_LOCALE", error: t("language.invalid") }, { status: 400 });
  }
  // A personal preference belongs to the real user, even during impersonation.
  await db.user.update({
    where: { id: session.user.id, organizationId: session.user.organizationId },
    data: { locale: requested },
    select: { id: true },
  });
  const response = NextResponse.json({ locale: requested });
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(SITE_LOCALE_COOKIE, requested, {
    path: "/", maxAge: 31536000, sameSite: "lax", secure: new URL(request.url).protocol === "https:",
  });
  return response;
}
