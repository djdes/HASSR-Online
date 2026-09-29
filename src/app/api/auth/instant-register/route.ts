import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { recordLegalConsent } from "@/lib/legal-consent";
import { issueSession } from "@/lib/issue-session";
import { sendAccountPasswordEmail } from "@/lib/email";
import { attachAccountForNewOrganization } from "@/lib/create-organization";
import { escapeTelegramHtml } from "@/lib/telegram";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { registrationCodeRateLimiter } from "@/lib/rate-limit";
import { domainAcceptsMail } from "@/lib/mail-domain";
import { DEFAULT_ORG_NAME, ORG_SPHERES, type OrgSphere } from "@/lib/org-profile";
import {
  JOURNAL_ENABLE_AUDIT_ACTION,
  blankSignupJournal,
  signupDisabledJournalCodes,
} from "@/lib/blank-signup";
import { defaultJournalAutomationJson } from "@/lib/journal-automation";
import {
  attachOrganizationByRef,
  readPartnerRefFromRequest,
} from "@/lib/partners/referral";
import { REFERRAL_COOKIE, readCookie } from "@/lib/balance/constants";
import { attachReferral, resolveReferrerByCode } from "@/lib/balance/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Мгновенная регистрация с лендинга: человек вводит почту — аккаунт
 * создаётся сразу, вход происходит автоматически, пароль уходит письмом.
 * Анкета (организация, имя, телефон) заполняется уже внутри кабинета.
 *
 * Только POST и только по явному клику: если бы аккаунт заводился при
 * GET-заходе на `/register?email=…`, любой краулер или префетч ссылки
 * плодил бы пустые организации и рассылал письма живым людям.
 */

/** Без похожих символов: 0/O, 1/l/I — пароль диктуют по телефону. */
const PASSWORD_ALPHABET =
  "23456789abcdefghjkmnpqrstuvwxyzACDEFHJKLMNPRTUVWXY";
const PASSWORD_LENGTH = 12;
// Название-заглушка живёт в org-profile: по нему кабинет понимает,
// что анкета ещё не заполнена (см. (dashboard)/layout.tsx).

function generatePassword(): string {
  let out = "";
  for (let i = 0; i < PASSWORD_LENGTH; i++) {
    out += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(request: Request) {
  const xff = request.headers.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0].trim() || "unknown";
  // Для rate-limit «unknown» — рабочий ключ, для БД это мусор: пусть
  // лучше стоит NULL, чем строка, по которой ROOT ничего не найдёт.
  const ipForLog = ip === "unknown" ? null : ip;

  const body = await request.json().catch(() => null);
  const email =
    typeof (body as { email?: unknown } | null)?.email === "string"
      ? (body as { email: string }).email.trim().toLowerCase()
      : "";
  // Откуда пришла регистрация: место формы, посадочная, referrer, utm.
  // Собирает клиент (lib/signup-source.ts), здесь только режем длину.
  const source = readSource((body as { source?: unknown } | null)?.source);
  // Обязательное согласие с документами (2026-09-22): без галки — отказ.
  const consentGiven = (body as { consent?: unknown } | null)?.consent === true;
  const consentPlace = (body as { consentPlace?: unknown } | null)?.consentPlace === "landing" ? "landing" : "register";
  // Сфера из ссылки с промокодом (/promo/CODE?s=cafe → /register?s=cafe):
  // только значения ORG_SPHERES, остальное молча игнорируем. С ней
  // организация сразу получает тип и набор журналов своей сферы.
  const rawSphere = (body as { sphere?: unknown } | null)?.sphere;
  const sphere: OrgSphere | null =
    typeof rawSphere === "string"
      ? (ORG_SPHERES.find((s) => s.value === rawSphere.trim().toLowerCase())?.value ?? null)
      : null;
  // Пришли по QR со скачанного шаблона (/qb): этот журнал у новой
  // организации включаем сразу — после регистрации он открывается готовым
  // к заполнению, а не экраном «Этот журнал отключён» (lib/blank-signup.ts).
  const signupJournals = signupDisabledJournalCodes(
    blankSignupJournal((body as { blankJournal?: unknown } | null)?.blankJournal),
    sphere ?? "other",
  );

  // Мусор отсекаем ДО расхода лимита, чтобы бот пустыми запросами не
  // выжигал квоту живому пользователю с того же IP (общий офисный NAT).
  if (!email || email.length > 200 || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Укажите корректный адрес электронной почты" },
      { status: 400 },
    );
  }

  if (!consentGiven) {
    return NextResponse.json(
      { error: "Отметьте согласие с офертой, соглашением и обработкой персональных данных" },
      { status: 400 },
    );
  }

  if (!registrationCodeRateLimiter.consume(`instant:${ip}`)) {
    return NextResponse.json(
      { error: "Слишком часто. Попробуйте через несколько минут" },
      { status: 429 },
    );
  }

  // Домен обязан принимать почту. Проверка в поле ввода — для удобства,
  // а здесь она обязательна: пароль существует только в письме, и на
  // несуществующий домен уйдёт в никуда вместе с доступом к аккаунту.
  if (!(await domainAcceptsMail(email.split("@")[1] ?? ""))) {
    return NextResponse.json(
      {
        error:
          "Такого почтового домена не существует — проверьте адрес. Письмо с паролем на него не дойдёт",
      },
      { status: 400 },
    );
  }

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    // Факт существования аккаунта и так раскрывался прежним визардом
    // (409 в register/request), поэтому здесь ничего нового не утекает —
    // зато человек сразу попадает на вход с подсказкой.
    return NextResponse.json({ exists: true });
  }

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);

  let created;
  try {
    created = await db.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          // Нейтральная заглушка: почта в названии протекала
          // в шапку кабинета, PDF-выгрузки и селектор организаций.
          // Настоящее название человек задаёт в анкете после входа.
          name: DEFAULT_ORG_NAME,
          type: sphere ?? "other",
          // Сразу минимальный набор журналов, а не весь каталог: иначе до
          // анкеты дашборд встречает человека счётчиком «0 из N» на весь каталог.
          // Сферу спросим в анкете — тогда набор пересчитается. С QR шаблона
          // журнал, за которым пришли, в наборе включён.
          disabledJournalCodes: signupJournals.disabledJournalCodes,
          // Автоматика гигиенического журнала — сразу, см.
          // defaultJournalAutomationJson.
          journalAutomationJson: defaultJournalAutomationJson(),
          subscriptionPlan: "free",
        },
      });
      const user = await tx.user.create({
        data: {
          email,
          // Имя пока равно почте — по этому признаку кабинет понимает,
          // что анкета не заполнена, и показывает баннер «Завершите
          // регистрацию».
          name: email,
          passwordHash,
          role: "manager",
          organizationId: organization.id,
          journalAccessMigrated: true,
          // Регистрация с лендинга сразу же и логинит человека, поэтому
          // адрес пишем в оба поля: первый вход — он же и есть.
          registrationIp: ipForLog,
          lastLoginIp: ipForLog,
          lastLoginAt: new Date(),
        },
      });
      // Аккаунт — владелец тарифа и общего лимита мест. Заводим сразу:
      // без него организация не умеет ни переключаться, ни расти во
      // вторую точку (см. lib/create-organization.ts).
      await attachAccountForNewOrganization(tx, {
        ownerUserId: user.id,
        organizationId: organization.id,
        subscriptionPlan: organization.subscriptionPlan,
        subscriptionEnd: organization.subscriptionEnd,
      });
      // Журнал включён не человеком в настройках, а регистрацией по QR —
      // в аудите организации это видно.
      if (signupJournals.enabledByBlank) {
        await tx.auditLog.create({
          data: {
            organizationId: organization.id,
            userId: user.id,
            userName: email,
            action: JOURNAL_ENABLE_AUDIT_ACTION,
            entity: "JournalTemplate",
            entityId: signupJournals.enabledByBlank,
            details: { journalCode: signupJournals.enabledByBlank, via: "blank-qr-signup" },
            ipAddress: ipForLog,
          },
        });
      }
      return { organization, user };
    });
  } catch (error) {
    // Гонка двух одновременных сабмитов с одной почтой: unique-индекс
    // на email не даст создать дубль — отправляем на вход.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unique constraint")) {
      return NextResponse.json({ exists: true });
    }
    console.error("instant-register failed", error);
    return NextResponse.json(
      { error: "Не получилось создать аккаунт. Попробуйте ещё раз" },
      { status: 500 },
    );
  }

  if (signupJournals.enabledByBlank) {
    console.info("[instant-register] journal enabled for blank QR signup", {
      organizationId: created.organization.id,
      code: signupJournals.enabledByBlank,
    });
  }
  if (sphere) {
    console.info("[instant-register] sphere from promo link", {
      organizationId: created.organization.id,
      sphere,
      disabledJournals: signupJournals.disabledJournalCodes.length,
    });
  }

  await recordLegalConsent({
    request,
    userId: created.user.id,
    email,
    organizationId: created.organization.id,
    source: consentPlace,
  }).catch((err) => console.error("legal consent record failed", err));

  // Письмо и уведомление — не блокируют вход: пользователь уже в кабинете,
  // упавшая почта не должна оборачиваться ошибкой регистрации.
  sendAccountPasswordEmail({
    to: email,
    password,
    organizationId: created.organization.id,
  }).catch((err) =>
    console.error("sendAccountPasswordEmail failed", err),
  );
  notifyOwner(email, source).catch((err) =>
    console.error("instant-register telegram notify failed", err),
  );
  // Пришёл по ссылке партнёра (/p/<slug>) — организация сразу под его
  // сопровождением. Ошибки внутри не роняют регистрацию.
  await attachOrganizationByRef({
    ref: readPartnerRefFromRequest(request),
    organizationId: created.organization.id,
    actorUserId: created.user.id,
  });

  // Реферальная ссылка клиента (/r/<code>): кто привёл эту организацию.
  // Баллы рекомендателю начислим, когда она оплатит подписку.
  await attachReferral({
    organizationId: created.organization.id,
    referrerOrganizationId:
      (await resolveReferrerByCode(readCookie(request, REFERRAL_COOKIE)))?.id ??
      null,
    actorUserId: created.user.id,
  });

  return issueSession(
    NextResponse.json({ ok: true, created: true }),
    created.user,
    created.organization.name,
  );
}

type SignupSource = {
  place: string;
  landing: string;
  referrer: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
};

function str(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function readSource(raw: unknown): SignupSource {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    place: str(o.place, 40),
    landing: str(o.landing),
    referrer: str(o.referrer, 500),
    utmSource: str(o.utmSource),
    utmMedium: str(o.utmMedium),
    utmCampaign: str(o.utmCampaign),
  };
}

async function notifyOwner(email: string, source: SignupSource): Promise<void> {
  // Единая точка админ-уведомлений: регистрации и обращения больше не
  // разъезжаются по двум разным chat id из разных env-переменных.
  const utm = [source.utmSource, source.utmMedium, source.utmCampaign]
    .filter(Boolean)
    .join(" / ");
  await notifyPlatformAdmin(
    [
      "🆕 Новая регистрация с лендинга",
      `Почта: ${escapeTelegramHtml(email)}`,
      source.place ? `Форма: ${escapeTelegramHtml(source.place)}` : "",
      source.landing ? `Страница: ${escapeTelegramHtml(source.landing)}` : "",
      source.referrer ? `Откуда: ${escapeTelegramHtml(source.referrer)}` : "",
      utm ? `UTM: ${escapeTelegramHtml(utm)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    { kind: "registration" },
  );
}
