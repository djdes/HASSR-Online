import bcrypt from "bcryptjs";
import crypto from "node:crypto";

import type { Locale } from "@/i18n/locales";
import { attachAccountForNewOrganization } from "@/lib/create-organization";
import { db } from "@/lib/db";
import {
  JOURNAL_ENABLE_AUDIT_ACTION,
  signupDisabledJournalCodes,
  type JournalEnableSource,
} from "@/lib/blank-signup";
import { defaultJournalAutomationJson } from "@/lib/journal-automation";
import { DEFAULT_ORG_NAME, type OrgSphere } from "@/lib/org-profile";
import { isEmptySnapshot, type SignupSourceSnapshot } from "@/lib/signup-channel";

/**
 * Кабинет «по почте»: организация-заглушка, руководитель и аккаунт тарифа
 * одной транзакцией. Пароль генерируется здесь и существует только в письме.
 *
 * Общий для мгновенной регистрации с лендинга (`/api/auth/instant-register`,
 * человек сразу входит) и галки «Быстрая регистрация» в окне скачивания
 * шаблона (`/api/public/blank-download`, вход — по ссылке из письма).
 * Анкета (название, имя, телефон, сфера) заполняется уже внутри кабинета:
 * по названию-заглушке и имени, равному почте, кабинет понимает, что она
 * не заполнена (см. (dashboard)/layout.tsx).
 */

/** Без похожих символов: 0/O, 1/l/I — пароль диктуют по телефону. */
const PASSWORD_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzACDEFHJKLMNPRTUVWXY";
const PASSWORD_LENGTH = 12;

export function generateInstantPassword(): string {
  let out = "";
  for (let i = 0; i < PASSWORD_LENGTH; i++) {
    out += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  }
  return out;
}

export type InstantAccountInput = {
  email: string;
  locale: Locale;
  /** Сфера из ссылки с промокодом — организация сразу с журналами сферы. */
  sphere: OrgSphere | null;
  /** Журнал каталога, за которым пришли (QR шаблона, окно скачивания), — включён сразу. */
  blankJournal: string | null;
  source: SignupSourceSnapshot;
  ip: string | null;
  /** Телефон, если человек его уже назвал (окно скачивания шаблона). */
  phone?: string | null;
  /** Человек входит этим же запросом — адрес регистрации он же и первого входа. */
  signedIn: boolean;
  /** Откуда включили журнал — в детали записи AuditLog. */
  journalEnableVia: Extract<JournalEnableSource, "blank-qr-signup" | "blank-download-signup">;
};

export type InstantAccount = Awaited<ReturnType<typeof createInstantAccount>>;

/**
 * Бросает исключение Prisma `Unique constraint`, если почта уже занята
 * (гонка двух одновременных запросов) — вызывающий отправляет на вход.
 */
export async function createInstantAccount(input: InstantAccountInput) {
  const password = generateInstantPassword();
  const passwordHash = await bcrypt.hash(password, 12);
  const signupJournals = signupDisabledJournalCodes(input.blankJournal, input.sphere ?? "other");

  const created = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        locale: input.locale,
        // Нейтральная заглушка: почта в названии протекала
        // в шапку кабинета, PDF-выгрузки и селектор организаций.
        // Настоящее название человек задаёт в анкете после входа.
        name: DEFAULT_ORG_NAME,
        type: input.sphere ?? "other",
        // Сразу минимальный набор журналов, а не весь каталог: иначе до
        // анкеты дашборд встречает человека счётчиком «0 из N» на весь каталог.
        // Сферу спросим в анкете — тогда набор пересчитается. С QR шаблона
        // журнал, за которым пришли, в наборе включён.
        disabledJournalCodes: signupJournals.disabledJournalCodes,
        // Автоматика гигиенического журнала — сразу, см.
        // defaultJournalAutomationJson.
        journalAutomationJson: defaultJournalAutomationJson(),
        subscriptionPlan: "free",
        // Источник визита — для воронки /root/funnel (по каналам).
        ...(isEmptySnapshot(input.source) ? {} : { signupSourceJson: input.source }),
      },
    });
    const user = await tx.user.create({
      data: {
        email: input.email,
        // Имя пока равно почте — по этому признаку кабинет понимает,
        // что анкета не заполнена, и показывает баннер «Завершите
        // регистрацию».
        name: input.email,
        passwordHash,
        role: "manager",
        organizationId: organization.id,
        locale: input.locale,
        journalAccessMigrated: true,
        ...(input.phone ? { phone: input.phone } : {}),
        registrationIp: input.ip,
        // Регистрация с лендинга сразу же и логинит человека, поэтому
        // адрес пишем в оба поля: первый вход — он же и есть.
        ...(input.signedIn ? { lastLoginIp: input.ip, lastLoginAt: new Date() } : {}),
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
    // Журнал включён не человеком в настройках, а регистрацией по QR
    // или из окна шаблона — в аудите организации это видно.
    if (signupJournals.enabledByBlank) {
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          userName: input.email,
          action: JOURNAL_ENABLE_AUDIT_ACTION,
          entity: "JournalTemplate",
          entityId: signupJournals.enabledByBlank,
          details: { journalCode: signupJournals.enabledByBlank, via: input.journalEnableVia },
          ipAddress: input.ip,
        },
      });
    }
    return { organization, user };
  });

  return { ...created, password, enabledByBlank: signupJournals.enabledByBlank, disabledJournalCodes: signupJournals.disabledJournalCodes };
}

/** Гонка двух одновременных сабмитов с одной почтой: unique-индекс на email. */
export function isDuplicateAccountError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Unique constraint");
}
