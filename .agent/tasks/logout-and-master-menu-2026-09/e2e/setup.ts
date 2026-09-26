// Стенд задачи: кафе с владельцем (член двух мастер-кабинетов), сотрудник
// бэк-офиса с приглашением, повар (телефон, личный QR, киоск), повар с
// Telegram, участник партнёра. Повторный запуск возвращает всё в исходное
// состояние (приглашение не использовано, PIN не заблокирован).
// Запуск: cd C:/wt/mkmenu && npx tsx .agent/tasks/logout-and-master-menu-2026-09/e2e/setup.ts
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";

import { ROOT, db } from "./db";
import { INVITE_RAW, KIOSK_DEVICE_ID, ORGS, PASSWORD, PIN, QR_RAW, USERS, type UserKey } from "./fixtures";

// Текущая редакция документов — из исходника (модуль тянет за собой базу приложения).
const LEGAL_VERSION = /LEGAL_VERSION = "([^"]+)"/.exec(
  fs.readFileSync(path.join(ROOT, "src", "lib", "legal-consent.ts"), "utf8"),
)?.[1];
if (!LEGAL_VERSION) throw new Error("не нашёл LEGAL_VERSION");

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

async function upsertOrg(key: keyof typeof ORGS, data: Record<string, unknown>) {
  const { id, name } = ORGS[key];
  const base = { name, type: "restaurant", phone: "+79990003999", isDemo: false, ...data };
  return db.organization.upsert({ where: { id }, update: base, create: { id, ...base } });
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const pinHash = await bcrypt.hash(PIN, 10);

  await upsertOrg("cafe", { kind: "regular", subscriptionPlan: "pro", subscriptionEnd: new Date(Date.now() + 365 * 86400_000), kioskEnabled: true });
  await upsertOrg("master", { kind: "directory" });
  await upsertOrg("master2", { kind: "directory" });
  await upsertOrg("consult", { kind: "regular" });

  const ids = {} as Record<UserKey, string>;
  for (const [key, u] of Object.entries(USERS) as Array<[UserKey, (typeof USERS)[UserKey]]>) {
    const orgId = ORGS[u.org].id;
    const categoryKey = u.role === "cook" ? "staff" : "management";
    const positionName = u.role === "cook" ? "Повар" : "Управляющий";
    const position =
      (await db.jobPosition.findFirst({ where: { organizationId: orgId, name: positionName } })) ??
      (await db.jobPosition.create({ data: { organizationId: orgId, name: positionName, categoryKey } }));
    if (u.tg) {
      // Telegram id уникален среди активных: снимаем его с чужих записей.
      await db.user.updateMany({ where: { telegramChatId: u.tg, NOT: { email: u.email } }, data: { telegramChatId: null } });
    }
    const invited = key === "master";
    const data = {
      name: u.name,
      role: u.role,
      organizationId: orgId,
      jobPositionId: position.id,
      // Сотрудник бэк-офиса ещё не принял приглашение: пароля нет, не активен.
      isActive: !invited,
      archivedAt: null,
      passwordHash: invited ? "" : passwordHash,
      phone: u.phone,
      telegramChatId: u.tg,
      journalAccessMigrated: false,
      twoFactorTelegram: false,
      // Окна «Что нового» и «Обновились документы» закрыли бы кнопки «Выйти».
      showWhatsNew: false,
      legalVersion: LEGAL_VERSION,
      lastActiveOrganizationId: null,
      qrPinHash: key === "cook" || key === "owner" ? pinHash : null,
      qrPinFailedCount: 0,
      qrPinLockedUntil: null,
    };
    const user = await db.user.upsert({ where: { email: u.email }, update: data, create: { email: u.email, ...data } });
    ids[key] = user.id;
  }

  // Аккаунт владельца: кафе и оба мастер-кабинета — в нём.
  const account = await db.account.upsert({
    where: { ownerUserId: ids.owner },
    update: { subscriptionPlan: "pro" },
    create: { ownerUserId: ids.owner, subscriptionPlan: "pro" },
  });
  await db.organization.updateMany({
    where: { id: { in: [ORGS.cafe.id, ORGS.master.id, ORGS.master2.id] } },
    data: { accountId: account.id },
  });
  // Владелец — член обоих мастер-кабинетов (так их заводит settings → «Мастер-кабинет»).
  for (const orgId of [ORGS.master.id, ORGS.master2.id]) {
    await db.organizationMember.upsert({
      where: { userId_organizationId: { userId: ids.owner, organizationId: orgId } },
      update: { role: "owner" },
      create: { userId: ids.owner, organizationId: orgId, role: "owner" },
    });
  }

  // Приглашение в мастер-кабинет: одна действующая ссылка.
  await db.inviteToken.deleteMany({ where: { userId: ids.master } });
  await db.inviteToken.create({
    data: { userId: ids.master, tokenHash: sha256(INVITE_RAW), expiresAt: new Date(Date.now() + 7 * 86400_000) },
  });

  // Личный QR: у повара и у владельца (хэш — как в lib/personal-login.ts).
  for (const key of ["cook", "owner"] as const) {
    await db.personalLoginToken.deleteMany({ where: { userId: ids[key] } });
    await db.personalLoginToken.create({
      data: { userId: ids[key], organizationId: ORGS.cafe.id, tokenHash: sha256(`personal-login:${QR_RAW[key]}`), createdById: ids.owner },
    });
  }

  // Киоск кафе.
  await db.kioskDevice.upsert({
    where: { id: KIOSK_DEVICE_ID },
    update: { revokedAt: null, organizationId: ORGS.cafe.id },
    create: { id: KIOSK_DEVICE_ID, organizationId: ORGS.cafe.id, label: "Планшет на кухне", secretHash: sha256(KIOSK_DEVICE_ID), createdById: ids.owner },
  });

  // Активный партнёр, онбординг пройден.
  const partner = await db.partner.upsert({
    where: { slug: "lmm-partner" },
    update: { status: "active", onboardingDoneAt: new Date(), applicantUserId: ids.partner },
    create: {
      slug: "lmm-partner",
      code: "LMMP01",
      status: "active",
      type: "consultant",
      companyName: "Консалт «Выход»",
      inn: "7700000001",
      city: "Москва",
      phone: "+79990003003",
      contactEmail: USERS.partner.email,
      termsAcceptedAt: new Date(),
      applicantUserId: ids.partner,
      applicantOrganizationId: ORGS.consult.id,
      onboardingDoneAt: new Date(),
    },
  });
  await db.partnerUser.upsert({
    where: { userId: ids.partner },
    update: { partnerId: partner.id, role: "owner" },
    create: { partnerId: partner.id, userId: ids.partner, role: "owner" },
  });

  console.log("OK", JSON.stringify(ids));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
