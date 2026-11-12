import type { Locale } from "@/i18n/locales";
import { REFERRAL_COOKIE, readCookie } from "@/lib/balance/constants";
import { attachReferral, resolveReferrerByCode } from "@/lib/balance/referral";
import { blankSignupPlace, type BlankTarget } from "@/lib/blank-download";
import { blankSignupJournal } from "@/lib/blank-signup";
import { db } from "@/lib/db";
import { createInstantAccount, isDuplicateAccountError } from "@/lib/instant-account.server";
import { recordLegalConsent } from "@/lib/legal-consent";
import { createMagicLink, SIGNUP_MAGIC_LINK_TTL_MS } from "@/lib/magic-link";
import { attachOrganizationByRef, readPartnerRefFromRequest } from "@/lib/partners/referral";
import { registrationCodeRateLimiter } from "@/lib/rate-limit";
import { readSignupSnapshot } from "@/lib/signup-channel";

/**
 * Галка «Быстрая регистрация» в окне скачивания шаблона (спека
 * blank-download-phone-autoreg-2026-11): кабинет заводится так же, как
 * мгновенной регистрацией с лендинга, но человек не входит этим запросом —
 * он на странице журнала и скачивает файл. Логин, пароль и одноразовую
 * ссылку автовхода (7 дней) получает письмом.
 *
 * Никогда не роняет скачивание: любая ошибка — `skipped`, файл отдаётся.
 */

export type BlankAccountOutcome =
  | {
      status: "created";
      userId: string;
      organizationId: string;
      password: string;
      autoLoginUrl: string | null;
    }
  | { status: "exists" }
  | { status: "skipped"; reason: "rate_limited" | "failed" };

/** Что окно говорит человеку: кабинет создан, уже был, или ничего не делали. */
export function blankAccountResponse(outcome: BlankAccountOutcome | null): "created" | "exists" | null {
  if (!outcome) return null;
  return outcome.status === "skipped" ? null : outcome.status;
}

export async function registerFromBlankDownload(params: {
  request: Request;
  email: string;
  phone: string | null;
  locale: Locale;
  target: BlankTarget;
  /** Сырой снимок источника визита из окна (lib/signup-source.ts). */
  source: unknown;
  ip: string | null;
  /** Ключ лимита: IP или «unknown» — общий с мгновенной регистрацией. */
  rateKey: string;
}): Promise<BlankAccountOutcome> {
  const existing = await db.user.findUnique({ where: { email: params.email }, select: { id: true } });
  // Почта уже зарегистрирована: кабинет не трогаем, окно предложит войти.
  // Факт существования и так раскрывает мгновенная регистрация (exists: true).
  if (existing) return { status: "exists" };

  if (!registrationCodeRateLimiter.consume(`instant:${params.rateKey}`)) {
    console.warn("[blank-download] quick registration skipped: rate limit", { ip: params.ip });
    return { status: "skipped", reason: "rate_limited" };
  }

  const journal = params.target.kind === "code" ? blankSignupJournal(params.target.code) : null;
  const journalKey = params.target.kind === "code" ? params.target.code : `paper:${params.target.paperId}`;
  // Место регистрации — всегда шаблон, даже если браузер прислал иное:
  // по нему воронка (/root/funnel) и уведомления отличают этот канал.
  const source = { ...readSignupSnapshot(params.source), place: blankSignupPlace(journalKey) };

  let created;
  try {
    created = await createInstantAccount({
      email: params.email,
      locale: params.locale,
      sphere: null,
      blankJournal: journal,
      source,
      ip: params.ip,
      phone: params.phone,
      signedIn: false,
      journalEnableVia: "blank-download-signup",
    });
  } catch (error) {
    if (isDuplicateAccountError(error)) return { status: "exists" };
    console.error("[blank-download] quick registration failed", error);
    return { status: "skipped", reason: "failed" };
  }

  // Галка согласия с ПДн обязательна в окне, галка регистрации ссылается на
  // оферту и соглашение — вместе это тот же текст, что у регистрации.
  await recordLegalConsent({
    request: params.request,
    userId: created.user.id,
    email: params.email,
    organizationId: created.organization.id,
    source: "blank-register",
  }).catch((error) => console.error("[blank-download] legal consent record failed", error));

  const autoLoginUrl = await createMagicLink(created.user.id, SIGNUP_MAGIC_LINK_TTL_MS).catch((error) => {
    console.error("[blank-download] auto-login link failed", error);
    return null;
  });

  // Партнёр (/p/<slug>) и реферальная ссылка (/r/<code>) — как у мгновенной
  // регистрации; ошибки внутри не роняют ни регистрацию, ни скачивание.
  try {
    await attachOrganizationByRef({
      ref: readPartnerRefFromRequest(params.request),
      organizationId: created.organization.id,
      actorUserId: created.user.id,
    });
    await attachReferral({
      organizationId: created.organization.id,
      referrerOrganizationId: (await resolveReferrerByCode(readCookie(params.request, REFERRAL_COOKIE)))?.id ?? null,
      actorUserId: created.user.id,
    });
  } catch (error) {
    console.error("[blank-download] partner/referral attach failed", error);
  }

  return {
    status: "created",
    userId: created.user.id,
    organizationId: created.organization.id,
    password: created.password,
    autoLoginUrl,
  };
}
