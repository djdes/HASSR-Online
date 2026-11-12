import { NextResponse, after } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import {
  BLANK_CONSENT_SOURCE,
  BLANK_DOWNLOAD_AUDIT_ACTION,
  BLANK_FORMAT_LABEL,
  blankBotVerdict,
  blankConsentRows,
  blankFilePath,
  blankPagePath,
  blankRegisterHref,
  buildBlankDownloadAdminText,
  shouldNotifyBlankDownloadAdmin,
  type BlankFormat,
  type BlankTarget,
} from "@/lib/blank-download";
import {
  ensurePlatformOrganization,
  findPlatformClientByEmail,
  recordBlankDownloadLead,
} from "@/lib/blank-download-lead.server";
import { blankDownloadLimiter } from "@/lib/blank-download-limits";
import {
  blankAccountResponse,
  registerFromBlankDownload,
  type BlankAccountOutcome,
} from "@/lib/blank-download-register.server";
import { parseBlankDownloadRequest } from "@/lib/blank-download-targets";
import {
  BLANK_DOWNLOAD_TTL_MS,
  blankDownloadHref,
  signBlankDownloadToken,
} from "@/lib/blank-download-token";
import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import { sendAccountPasswordEmail, sendBlankDownloadEmail } from "@/lib/email";
import { LEGAL_VERSION } from "@/lib/legal-consent";
import { SIGNUP_MAGIC_LINK_TTL_MS } from "@/lib/magic-link";
import { domainAcceptsMail } from "@/lib/mail-domain";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { escapeTelegramHtml } from "@/lib/telegram";
import { translatorFor } from "@/i18n/translator";
import { loadMessages } from "@/i18n/messages";
import { localizedHref } from "@/i18n/site-locale";
import {
  blankConsentSnapshot,
  blankMarketingConsentSnapshot,
} from "@/lib/blank-download-presentation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = (process.env.NEXTAUTH_URL || "https://wesetup.ru").replace(/\/+$/, "");
const PLATFORM_ORG_ID = process.env.PLATFORM_ORG_ID || "platform";

// Домены почты повторяются (gmail.com, mail.ru): DNS спрашиваем раз в 6 часов.
const domainCache = new Map<string, { ok: boolean; at: number }>();
const DOMAIN_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

async function domainOk(domain: string): Promise<boolean> {
  const cached = domainCache.get(domain);
  if (cached && Date.now() - cached.at < DOMAIN_CACHE_TTL_MS) return cached.ok;
  const ok = await domainAcceptsMail(domain);
  if (domainCache.size >= 500) domainCache.clear();
  domainCache.set(domain, { ok, at: Date.now() });
  return ok;
}

/**
 * POST /api/public/blank-download — шаблон журнала после email.
 *
 * Тело: `{ email, code | paperId, format, consent: true, marketing?, remembered?, consentVersion?,
 * phone?, register?, source?, website?, elapsedMs? }`.
 * Ответ: `{ url }` — подписанная ссылка на файл (7 дней). По пути:
 *   1. согласие записывается в LegalConsent (source "blank-download",
 *      дословный текст галки, IP, браузер) — это же учёт лидов для /root;
 *      отмечена необязательная галка «Присылать полезные материалы» —
 *      рядом вторая запись (source "blank-download-marketing") с её
 *      текстом, в той же транзакции; журнал и формат — в AuditLog
 *      платформы со ссылкой на согласие;
 *   2. ссылки дублируются письмом (после ответа, ошибки письма не мешают
 *      скачиванию);
 *   3. отмечена галка «Быстрая регистрация» (спека
 *      blank-download-phone-autoreg-2026-11) — кабинет создаётся сразу,
 *      логин, пароль и ссылка автовхода уходят отдельным письмом. Ответ
 *      `account: "created" | "exists" | null`.
 *
 * Невидимая проверка от ботов (`blankBotVerdict`): заполнено поле-ловушка —
 * ответ похож на успешный, но ничего не пишется и не отправляется; окно
 * отправлено слишком быстро — мягкая ошибка `too_fast`.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = parseBlankDownloadRequest(body, LEGAL_VERSION);
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: parsed.error,
        errorCode: parsed.errorCode,
        ...(parsed.needConsent ? { needConsent: true } : {}),
      },
      { status: parsed.status },
    );
  }
  const { email, company, info, format, marketing, locale, phone, register } = parsed.value;

  const rawBody = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const bot = blankBotVerdict({
    website: rawBody.website,
    elapsedMs: rawBody.elapsedMs,
    remembered: rawBody.remembered === true,
  });
  const ip = clientIp(request) ?? "unknown";
  if (bot === "honeypot") {
    // Человек это поле не видит. Боту отвечаем как обычно, но без следов:
    // ни согласия, ни лида, ни уведомления продажам, ни писем. Ссылка без
    // токена ведёт обратно на страницу журнала.
    console.warn("[blank-download] honeypot filled, request dropped", { ip });
    return NextResponse.json(
      { ok: true, url: blankFilePath(info.target, format, locale), emailed: false, consentVersion: LEGAL_VERSION, account: null, page: blankPagePath(info.target, format) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (bot === "too_fast") {
    console.warn("[blank-download] form submitted too fast", { ip });
    return NextResponse.json(
      { error: "Не получилось отправить форму. Обновите страницу и попробуйте ещё раз", errorCode: "too_fast" },
      { status: 400 },
    );
  }

  const limited = blankDownloadLimiter.consume(ip, email);
  if (limited) {
    return NextResponse.json(
      {
        error:
          limited.scope === "ip"
            ? "Слишком много скачиваний с этого адреса. Попробуйте через час"
            : "На эту почту сегодня скачали слишком много шаблонов. Попробуйте завтра",
        errorCode: limited.scope === "ip" ? "rate_limit_ip" : "rate_limit_email",
      },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  if (!(await domainOk(email.split("@")[1] ?? ""))) {
    return NextResponse.json(
      {
        error: "Такого почтового домена не существует — проверьте адрес. Письмо на него не дойдёт",
        errorCode: "email_domain",
      },
      { status: 400 },
    );
  }

  let platformClient = await findPlatformClientByEmail(email).catch(() => null);

  let consentId: string;
  let consentCreatedAt: Date;
  let marketingConsentId: string | null = null;
  let t: Awaited<ReturnType<typeof translatorFor>>;
  try {
    t = await translatorFor(locale);
    const consentRichMessage = t.raw("publicBlankDownload.consent.statement");
    const marketingRichMessage = t.raw("publicBlankDownload.marketing.statement");
    if (typeof consentRichMessage !== "string" || typeof marketingRichMessage !== "string") {
      throw new Error("Blank download consent catalog is unavailable");
    }
    const rows = blankConsentRows({
      email,
      version: LEGAL_VERSION,
      marketing,
      ipAddress: ip === "unknown" ? null : ip,
      userAgent: request.headers.get("user-agent")?.slice(0, 400) ?? null,
      userId: platformClient?.userId,
      organizationId: platformClient?.organizationId,
      statementText: blankConsentSnapshot(consentRichMessage),
      marketingStatementText: blankMarketingConsentSnapshot(marketingRichMessage),
    });
    const created = await db.$transaction(
      rows.map((data) => db.legalConsent.create({ data, select: { id: true, createdAt: true } })),
    );
    consentId = created[0].id;
    consentCreatedAt = created[0].createdAt;
    marketingConsentId = created[1]?.id ?? null;
  } catch (error) {
    console.error("[blank-download] consent record failed", error);
    return NextResponse.json({ error: "Не получилось подготовить шаблон. Попробуйте ещё раз", errorCode: "server_failure" }, { status: 500 });
  }

  const target = info.target;

  // Галка «Быстрая регистрация»: кабинет — до записи лида, чтобы CRM сразу
  // связала скачивание с новым клиентом. Ошибка регистрации скачиванию не мешает.
  let account: BlankAccountOutcome | null = null;
  if (register) {
    account = await registerFromBlankDownload({
      request,
      email,
      phone: phone ?? null,
      locale,
      target,
      source: parsed.value.source,
      ip: ip === "unknown" ? null : ip,
      rateKey: ip,
    }).catch((error): BlankAccountOutcome => {
      console.error("[blank-download] quick registration crashed", error);
      return { status: "skipped", reason: "failed" };
    });
    if (account.status === "created") {
      platformClient = (await findPlatformClientByEmail(email).catch(() => null)) ?? platformClient;
    }
  }
  const accountCreated = account?.status === "created";

  await ensurePlatformOrganization(PLATFORM_ORG_ID).catch((error) => {
    console.error("[blank-download] platform org ensure failed", error);
  });
  await recordAuditLog({
    request,
    organizationId: PLATFORM_ORG_ID,
    action: BLANK_DOWNLOAD_AUDIT_ACTION,
    entity: "LegalConsent",
    entityId: consentId,
    details: {
      email,
      ...(phone ? { phone } : {}),
      ...(company ? { company } : {}),
      format,
      title: info.title,
      ...(account ? { account: account.status } : {}),
      ...(target.kind === "code" ? { code: target.code } : { paperId: target.paperId }),
      marketing: marketingConsentId !== null,
      ...(marketingConsentId ? { marketingConsentId } : {}),
    },
  });

  await recordBlankDownloadLead({
    consentId,
    createdAt: consentCreatedAt,
    email,
    phone: phone ?? null,
    company,
    target,
    title: info.title,
    marketing: marketingConsentId !== null,
    platformClient,
  }).catch((error) => {
    console.error("[blank-download] lead sync failed", error);
  });

  const now = Date.now();
  const hrefFor = (fileFormat: BlankFormat) =>
    blankDownloadHref(target, fileFormat, signBlankDownloadToken({ email, company, target, format: fileFormat }, now), locale);
  const url = hrefFor(format);

  // Лимит писем проверяем до ответа — окно честно скажет, ушла ли копия.
  const emailed = blankDownloadLimiter.consumeEmail(email);
  if (!emailed) console.warn("[blank-download] email skipped: daily letters limit", { consentId });

  after(async () => {
    try {
      const dedupeKey = `blank_download:${email}`;
      const [previousDownloadsCount, alreadyNotifiedCount] = await Promise.all([
        db.legalConsent.count({
          where: {
            source: BLANK_CONSENT_SOURCE,
            id: { not: consentId },
            createdAt: { lte: consentCreatedAt },
            OR: [
              { email: { equals: email, mode: "insensitive" } },
              ...(platformClient?.userId ? [{ userId: platformClient.userId }] : []),
            ],
          },
        }),
        db.telegramLog.count({
          where: {
            kind: "admin:blank_download",
            dedupeKey,
            status: { in: ["sent", "queued", "deferred"] },
          },
        }),
      ]);
      if (shouldNotifyBlankDownloadAdmin(previousDownloadsCount + alreadyNotifiedCount, accountCreated)) {
        await notifyPlatformAdmin(
          buildBlankDownloadAdminText({
            title: info.title,
            format,
            email,
            phone,
            company,
            accountCreated,
            escape: escapeTelegramHtml,
          }),
          {
            kind: "blank_download",
            // Повторное скачивание с новым кабинетом — своё событие, не дубль.
            dedupeKey: accountCreated && previousDownloadsCount + alreadyNotifiedCount > 0 ? `blank_register:${email}` : dedupeKey,
            email: false,
            audience: "sales",
          },
        );
      }
    } catch (error) {
      console.error("[blank-download] admin telegram notify failed", error);
    }

    // Доступ в новый кабинет — всегда, без дневного лимита писем со
    // ссылками на шаблоны: пароль существует только в этом письме.
    if (account?.status === "created") {
      try {
        await sendAccountPasswordEmail({
          to: email,
          password: account.password,
          organizationId: account.organizationId,
          locale,
          via: "blank",
          autoLoginUrl: account.autoLoginUrl,
          autoLoginDays: Math.round(SIGNUP_MAGIC_LINK_TTL_MS / (24 * 60 * 60 * 1000)),
        });
      } catch (error) {
        console.error("[blank-download] account email failed", error);
      }
    }

    if (!emailed) return;
    const files = [format, ...info.formats.filter((other) => other !== format)].map((fileFormat) => ({
      label: t("publicBlankDownload.email.fileLabel", { format: BLANK_FORMAT_LABEL[fileFormat] }),
      url: `${APP_URL}${fileFormat === format ? url : hrefFor(fileFormat)}`,
    }));
    try {
      await sendBlankDownloadEmail({
        to: email,
        journalTitle: localizedProductTitle((await loadMessages(locale)).journals.names, target, info.title),
        files,
        pageUrl: target.kind === "code" ? `${APP_URL}${localizedHref(`/journals-info/${encodeURIComponent(target.code)}`, locale)}` : null,
        registerUrl: `${APP_URL}${localizedHref(blankRegisterHref({ email, target }), locale)}`,
        expiresDays: Math.round(BLANK_DOWNLOAD_TTL_MS / (24 * 60 * 60 * 1000)),
        locale,
        accountCreated,
      });
    } catch (error) {
      console.error("[blank-download] email failed", error);
    }
  });

  return NextResponse.json(
    { ok: true, url, emailed, consentVersion: LEGAL_VERSION, account: blankAccountResponse(account), page: blankPagePath(target, format) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function localizedProductTitle(names: unknown, target: BlankTarget, fallback: string): string {
  if (target.kind !== "code" || !names || typeof names !== "object" || Array.isArray(names)) return fallback;
  const value = Object.entries(names).find(([code]) => code === target.code)?.[1];
  return typeof value === "string" ? value : fallback;
}
