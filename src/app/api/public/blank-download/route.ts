import { NextResponse, after } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import {
  BLANK_DOWNLOAD_AUDIT_ACTION,
  BLANK_FORMAT_LABEL,
  blankConsentRows,
  blankPagePath,
  blankRegisterHref,
  type BlankFormat,
  type BlankTarget,
} from "@/lib/blank-download";
import { blankDownloadLimiter } from "@/lib/blank-download-limits";
import { parseBlankDownloadRequest } from "@/lib/blank-download-targets";
import {
  BLANK_DOWNLOAD_TTL_MS,
  blankDownloadHref,
  signBlankDownloadToken,
} from "@/lib/blank-download-token";
import { clientIp } from "@/lib/client-ip";
import { db } from "@/lib/db";
import { sendBlankDownloadEmail } from "@/lib/email";
import { LEGAL_VERSION } from "@/lib/legal-consent";
import { domainAcceptsMail } from "@/lib/mail-domain";
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
 * Тело: `{ email, code | paperId, format, consent: true, marketing?, remembered?, consentVersion? }`.
 * Ответ: `{ url }` — подписанная ссылка на файл (7 дней). По пути:
 *   1. согласие записывается в LegalConsent (source "blank-download",
 *      дословный текст галки, IP, браузер) — это же учёт лидов для /root;
 *      отмечена необязательная галка «Присылать полезные материалы» —
 *      рядом вторая запись (source "blank-download-marketing") с её
 *      текстом, в той же транзакции; журнал и формат — в AuditLog
 *      платформы со ссылкой на согласие;
 *   2. ссылки дублируются письмом (после ответа, ошибки письма не мешают
 *      скачиванию).
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
  const { email, info, format, marketing, locale } = parsed.value;

  const ip = clientIp(request) ?? "unknown";
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

  let consentId: string;
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
      statementText: blankConsentSnapshot(consentRichMessage),
      marketingStatementText: blankMarketingConsentSnapshot(marketingRichMessage),
    });
    const created = await db.$transaction(
      rows.map((data) => db.legalConsent.create({ data, select: { id: true } })),
    );
    consentId = created[0].id;
    marketingConsentId = created[1]?.id ?? null;
  } catch (error) {
    console.error("[blank-download] consent record failed", error);
    return NextResponse.json({ error: "Не получилось подготовить шаблон. Попробуйте ещё раз", errorCode: "server_failure" }, { status: 500 });
  }

  const target = info.target;
  await recordAuditLog({
    request,
    organizationId: PLATFORM_ORG_ID,
    action: BLANK_DOWNLOAD_AUDIT_ACTION,
    entity: "LegalConsent",
    entityId: consentId,
    details: {
      email,
      format,
      title: info.title,
      ...(target.kind === "code" ? { code: target.code } : { paperId: target.paperId }),
      marketing: marketingConsentId !== null,
      ...(marketingConsentId ? { marketingConsentId } : {}),
    },
  });

  const now = Date.now();
  const hrefFor = (fileFormat: BlankFormat) =>
    blankDownloadHref(target, fileFormat, signBlankDownloadToken({ email, target, format: fileFormat }, now), locale);
  const url = hrefFor(format);

  // Лимит писем проверяем до ответа — окно честно скажет, ушла ли копия.
  const emailed = blankDownloadLimiter.consumeEmail(email);
  if (!emailed) console.warn("[blank-download] email skipped: daily letters limit", { consentId });

  after(async () => {
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
      });
    } catch (error) {
      console.error("[blank-download] email failed", error);
    }
  });

  return NextResponse.json(
    { ok: true, url, emailed, consentVersion: LEGAL_VERSION, page: blankPagePath(target, format) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

function localizedProductTitle(names: unknown, target: BlankTarget, fallback: string): string {
  if (target.kind !== "code" || !names || typeof names !== "object" || Array.isArray(names)) return fallback;
  const value = Object.entries(names).find(([code]) => code === target.code)?.[1];
  return typeof value === "string" ? value : fallback;
}
