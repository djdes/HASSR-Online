/**
 * Источник визита на сервере (спека visit-source-2026-11): cookie первого
 * касания (`wesetup_src`, пишет `VisitSourceTracker`) и снимок из тела
 * формы. Сохраняется в организацию (`signupSourceJson`) и в контакт CRM
 * (`visitSourceJson`) — один раз, первое касание не перезаписываем.
 */

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { normalizeEmail, phoneKey } from "@/lib/crm/identity";
import { isEmptySnapshot, readSignupSnapshot, signupChannel, type SignupSourceSnapshot } from "@/lib/signup-channel";
import { VISIT_SOURCE_COOKIE } from "@/lib/signup-source";

/** Значение cookie из заголовка `Cookie` (без зависимостей от next/headers). */
function cookieValue(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/** Снимок первого касания из cookie запроса; нет или пустой — `null`. */
export function visitSourceFromCookieHeader(header: string | null | undefined, place = ""): SignupSourceSnapshot | null {
  const raw = cookieValue(header, VISIT_SOURCE_COOKIE);
  if (!raw) return null;
  try {
    const snapshot = readSignupSnapshot({ ...JSON.parse(decodeURIComponent(raw)), place });
    return isEmptySnapshot({ ...snapshot, place: "" }) ? null : snapshot;
  } catch {
    return null;
  }
}

export function visitSourceFromRequest(request: Request | null | undefined, place = ""): SignupSourceSnapshot | null {
  return visitSourceFromCookieHeader(request?.headers.get("cookie"), place);
}

/**
 * Источник для записи: снимок формы, если он содержательный, иначе cookie.
 * `place` формы сохраняем в любом случае — какая кнопка сработала.
 */
export function requestSignupSource(request: Request | null | undefined, body: SignupSourceSnapshot | null | undefined): SignupSourceSnapshot | null {
  const form = body && !isEmptySnapshot({ ...body, place: "" }) ? body : null;
  // Форма с внешним referrer, utm или меткой клика — содержательна сама;
  // «прямой заход» (свой сайт, пусто) уступает cookie первого касания.
  if (form && !["direct", "unknown"].includes(signupChannel(form))) return form;
  const cookie = visitSourceFromRequest(request, body?.place ?? "");
  return cookie ?? form ?? (body && !isEmptySnapshot(body) ? body : null);
}

/** Организации без источника — записать первое касание. */
export async function rememberOrganizationVisitSource(organizationId: string, source: SignupSourceSnapshot | null): Promise<void> {
  if (!source || isEmptySnapshot(source)) return;
  await db.organization
    .updateMany({ where: { id: organizationId, signupSourceJson: { equals: Prisma.DbNull } }, data: { signupSourceJson: source as Prisma.InputJsonValue } })
    .catch((error) => console.error("[visit-source] organization update failed", error));
}

/** Контакту CRM (по почте/телефону) без источника — записать первое касание. */
export async function rememberContactVisitSource(
  contact: { email?: string | null; phone?: string | null },
  source: SignupSourceSnapshot | null,
): Promise<void> {
  if (!source || isEmptySnapshot(source)) return;
  const email = normalizeEmail(contact.email);
  const phone = phoneKey(contact.phone);
  if (!email && !phone) return;
  await db.crmContact
    .updateMany({
      where: {
        OR: [...(email ? [{ email }] : []), ...(phone ? [{ phoneKey: phone }] : [])],
        visitSourceJson: { equals: Prisma.DbNull },
      },
      data: { visitSourceJson: source as Prisma.InputJsonValue },
    })
    .catch((error) => console.error("[visit-source] crm contact update failed", error));
}
