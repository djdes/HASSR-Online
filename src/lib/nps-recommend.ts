import type { ColleagueRecommendationEmailParams } from "@/lib/email";
import { checkEmail } from "@/lib/email-validation";
import {
  NPS_RECOMMEND_MESSAGE_MAX_LENGTH,
  NPS_RECOMMEND_PER_ORG_PER_DAY,
  NPS_RECOMMEND_PER_USER_PER_DAY,
  normalizeNpsScale,
  npsInvitesRecommendation,
} from "@/lib/nps";
import { isTechnicalEmail } from "@/lib/technical-email";

/**
 * Рекомендация коллеге из опроса «Посоветуете WeSetup коллегам?».
 *
 * Оценка 4–5 уже сохранена (`POST /api/nps`), здесь — только письмо: от
 * WeSetup, с именем и организацией рекомендующего, его текстом и ссылкой
 * на регистрацию (реферальной, если у организации есть код клиентской
 * программы «порекомендуй другу»). Ответ получателя уходит рекомендующему.
 *
 * Эндпоинт шлёт произвольный текст на произвольный адрес с домена
 * wesetup.ru, поэтому лимиты — не удобство, а защита от открытого релея:
 * не больше 5 писем в сутки на человека и 20 на организацию, один адрес —
 * не чаще раза в сутки. Проверка лимитов и отправка идут под
 * advisory-замком организации, иначе пачка параллельных запросов прошла бы
 * проверку до первой записи в AuditLog. Каждая отправка — строка AuditLog
 * (кому, реферальная ли ссылка, оценка) без текста письма.
 *
 * Вся работа с базой и почтой — через `deps`: маршрут
 * `src/app/api/nps/recommend/route.ts` подставляет настоящие, тесты — свои.
 */

export const NPS_RECOMMEND_AUDIT_ACTION = "nps.recommend";
export const NPS_RECOMMEND_AUDIT_ENTITY = "NpsResponse";

const DAY_MS = 24 * 60 * 60 * 1000;

export type NpsRecommendField = "email" | "message";

export type NpsRecommendInput = { responseId: string; email: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Тело `POST /api/nps/recommend`: `{ responseId, email, message }`. */
export function parseNpsRecommendation(
  body: unknown,
): { ok: true; value: NpsRecommendInput } | { ok: false; error: string; field?: NpsRecommendField } {
  const input = isRecord(body) ? body : {};
  const responseId = typeof input.responseId === "string" ? input.responseId.trim() : "";
  if (!responseId || responseId.length > 64) return { ok: false, error: "Сначала поставьте оценку" };

  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const check = checkEmail(email);
  if (check.status === "empty") return { ok: false, error: "Укажите почту коллеги", field: "email" };
  if (check.status === "invalid") return { ok: false, error: check.message, field: "email" };
  // «typo» (похоже на опечатку в популярном домене) — только подсказка в
  // форме: у коллеги может быть редкий домен вроде mail.kz. Несуществующий
  // домен отсечёт проверка MX.

  if (input.message !== undefined && input.message !== null && typeof input.message !== "string") {
    return { ok: false, error: "Сообщение должно быть текстом", field: "message" };
  }
  const message = typeof input.message === "string" ? input.message.replace(/\r\n?/g, "\n").trim() : "";
  if (message.length > NPS_RECOMMEND_MESSAGE_MAX_LENGTH) {
    return { ok: false, error: `Сообщение длиннее ${NPS_RECOMMEND_MESSAGE_MAX_LENGTH} символов — сократите его`, field: "message" };
  }
  return { ok: true, value: { responseId, email, message } };
}

/**
 * Ссылка в письме. Код есть — `/r/<код>`: cookie рекомендателя, и бонус
 * начислится при оплате; нет — обычная регистрация. Почта получателя
 * подставляется в форму регистрации (`?email=`).
 */
export function recommendationLink(input: {
  appUrl: string;
  referralCode: string | null | undefined;
  recipient: string;
}): { link: string; referral: boolean } {
  const base = input.appUrl.replace(/\/+$/, "");
  const query = `email=${encodeURIComponent(input.recipient)}`;
  const code = (input.referralCode ?? "").trim();
  if (code) return { link: `${base}/r/${encodeURIComponent(code)}?${query}`, referral: true };
  return { link: `${base}/register?${query}`, referral: false };
}

/**
 * Имя в письме. Пустое, совпадающее с названием организации (так
 * заполняет мгновенная регистрация) или похожее на почту — не пишем:
 * «Коллега из «Кафе» советует…» читается лучше, чем «Кафе из «Кафе»…».
 */
export function senderDisplayName(name: string | null | undefined, organizationName: string | null | undefined): string | null {
  const value = (name ?? "").trim();
  if (!value || value.includes("@")) return null;
  if (value.toLowerCase() === (organizationName ?? "").trim().toLowerCase()) return null;
  return value;
}

/** Адрес для ответа: контактная почта, иначе логин; служебные адреса — нет. */
export function replyToAddress(sender: { email: string | null; contactEmail: string | null }): string | null {
  for (const candidate of [sender.contactEmail, sender.email]) {
    const value = (candidate ?? "").trim().toLowerCase();
    if (!value || isTechnicalEmail(value)) continue;
    if (checkEmail(value).status === "invalid") continue;
    return value;
  }
  return null;
}

export type NpsRecommendResponseRow = {
  id: string;
  userId: string;
  organizationId: string;
  score: number;
  scale: number | null;
};

export type NpsRecommendDelivery = "sent" | "logged";

export type NpsRecommendAuditDetails = {
  /** Кому ушло письмо. Текст письма не храним. */
  colleagueEmail: string;
  referral: boolean;
  npsScore: number;
  /** logged — почта не настроена (dev), письмо записано в лог сервера. */
  delivery: NpsRecommendDelivery;
};

export type NpsRecommendDeps = {
  appUrl: string;
  now(): Date;
  findResponse(id: string): Promise<NpsRecommendResponseRow | null>;
  loadSender(userId: string): Promise<{ name: string | null; email: string | null; contactEmail: string | null } | null>;
  loadOrganization(organizationId: string): Promise<{ name: string; referralCode: string | null } | null>;
  /** Адрес принадлежит сотруднику (логин или контактная почта) этой организации. */
  isOrganizationStaffEmail(organizationId: string, email: string): Promise<boolean>;
  domainAcceptsMail(domain: string): Promise<boolean>;
  withOrganizationLock<T>(organizationId: string, fn: () => Promise<T>): Promise<{ acquired: true; value: T } | { acquired: false }>;
  /** Сколько рекомендаций отправлено с `since` — по человеку, организации, адресу. */
  countSent(filter: { since: Date; userId?: string; organizationId?: string; recipient?: string }): Promise<number>;
  sendEmail(params: ColleagueRecommendationEmailParams): Promise<NpsRecommendDelivery | "failed">;
  recordAudit(entry: { organizationId: string; responseId: string; details: NpsRecommendAuditDetails }): Promise<void>;
};

export type NpsRecommendResult =
  | { status: 200; body: { ok: true; referral: boolean; delivery: NpsRecommendDelivery } }
  | { status: 400 | 404 | 429 | 502; body: { error: string; field?: NpsRecommendField } };

function fail(status: 400 | 404 | 429 | 502, error: string, field?: NpsRecommendField): NpsRecommendResult {
  return { status, body: field ? { error, field } : { error } };
}

export async function runNpsRecommendation(
  input: { userId: string; body: unknown },
  deps: NpsRecommendDeps,
): Promise<NpsRecommendResult> {
  const parsed = parseNpsRecommendation(input.body);
  if (!parsed.ok) return fail(400, parsed.error, parsed.field);
  const { responseId, email, message } = parsed.value;

  const response = await deps.findResponse(responseId);
  if (!response || response.userId !== input.userId) return fail(404, "Ответ не найден — обновите страницу");
  if (!npsInvitesRecommendation(response.score, normalizeNpsScale(response.scale))) {
    return fail(400, "Рекомендация доступна после оценки 4 или 5");
  }
  const organizationId = response.organizationId;

  const [sender, organization] = await Promise.all([deps.loadSender(input.userId), deps.loadOrganization(organizationId)]);
  if (!sender || !organization) return fail(404, "Ответ не найден — обновите страницу");

  const ownEmails = [sender.email, sender.contactEmail].map((value) => (value ?? "").trim().toLowerCase()).filter(Boolean);
  if (ownEmails.includes(email)) return fail(400, "Это ваша почта — укажите адрес коллеги", "email");
  if (await deps.isOrganizationStaffEmail(organizationId, email)) {
    return fail(400, "Это почта сотрудника вашей организации — укажите коллегу из другого заведения", "email");
  }
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (!(await deps.domainAcceptsMail(domain))) {
    return fail(400, `Почтового домена ${domain} не существует — проверьте адрес`, "email");
  }

  const locked = await deps.withOrganizationLock(organizationId, async (): Promise<NpsRecommendResult> => {
    const since = new Date(deps.now().getTime() - DAY_MS);
    const [byUser, byOrganization, toRecipient] = await Promise.all([
      deps.countSent({ since, userId: input.userId }),
      deps.countSent({ since, organizationId }),
      deps.countSent({ since, organizationId, recipient: email }),
    ]);
    if (byUser >= NPS_RECOMMEND_PER_USER_PER_DAY) {
      return fail(429, `Не больше ${NPS_RECOMMEND_PER_USER_PER_DAY} рекомендаций в сутки — попробуйте завтра`);
    }
    if (byOrganization >= NPS_RECOMMEND_PER_ORG_PER_DAY) {
      return fail(429, "Из вашей организации сегодня уже отправили много рекомендаций — попробуйте завтра");
    }
    if (toRecipient > 0) return fail(429, "Этому адресу сегодня уже отправляли рекомендацию", "email");

    const { link, referral } = recommendationLink({ appUrl: deps.appUrl, referralCode: organization.referralCode, recipient: email });
    const delivery = await deps.sendEmail({
      to: email,
      fromUserName: senderDisplayName(sender.name, organization.name),
      fromOrganizationName: organization.name,
      message,
      link,
      referral,
      replyTo: replyToAddress(sender),
    });
    if (delivery === "failed") return fail(502, "Письмо не ушло — попробуйте позже");
    await deps.recordAudit({ organizationId, responseId, details: { colleagueEmail: email, referral, npsScore: response.score, delivery } });
    return { status: 200, body: { ok: true, referral, delivery } };
  });
  if (!locked.acquired) return fail(429, "Письмо уже отправляется — подождите пару секунд");
  return locked.value;
}
