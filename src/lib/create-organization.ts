import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizeSphere, type OrgSphere } from "@/lib/org-profile";
import { defaultDisabledCodesFor } from "@/lib/sphere-journal-rules";
import { defaultJournalAutomationJson } from "@/lib/journal-automation";
import { copyOrgLogo } from "@/lib/org-logo";
import { orgLogoAssetOwner } from "@/lib/org-logo-file";

/**
 * Создание организации внутри аккаунта.
 *
 * Одно место на всё приложение: мгновенная регистрация, подтверждение
 * регистрации, оплата и демо-организация ROOT'а раньше собирали
 * `organization.create` каждая по-своему, и набор журналов, тариф и
 * членство владельца расходились между этими путями.
 *
 * Шаблоны журналов глобальные, поэтому seed'ить новую организацию не
 * нужно — копируем только то, что живёт per-org: должности с их доступом
 * к журналам и оформление.
 */

export type CreateOrganizationInput = {
  name: string;
  sphere: OrgSphere | string;
  /** Аккаунт, которому принадлежит организация. */
  accountId: string;
  /** Кто становится владельцем — получает OrganizationMember(role="owner"). */
  ownerUserId: string;
  /** Организация-донор: копируем должности и набор журналов. */
  copyFromOrganizationId?: string | null;
};

export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<{ organizationId: string }> {
  const sphere = normalizeSphere(input.sphere);

  const source = input.copyFromOrganizationId
    ? await db.organization.findUnique({
        where: { id: input.copyFromOrganizationId },
        select: {
          id: true,
          accountId: true,
          disabledJournalCodes: true,
          autoJournalCodes: true,
          locale: true,
          brandColor: true,
          logoUrl: true,
        },
      })
    : null;

  // Копировать можно только из своего же аккаунта — иначе через
  // подставленный id утекли бы чужие настройки и структура должностей.
  const donor = source && source.accountId === input.accountId ? source : null;

  const organization = await db.organization.create({
    data: {
      name: input.name.trim(),
      type: sphere,
      accountId: input.accountId,
      subscriptionPlan: "free",
      disabledJournalCodes: donor
        ? (donor.disabledJournalCodes as never)
        : (defaultDisabledCodesFor(sphere) as never),
      // Гигиенический журнал ведётся сам с первого дня: иначе новая
      // компания месяцами не подозревает, что автоматика существует.
      journalAutomationJson: defaultJournalAutomationJson() as never,
      ...(donor
        ? {
            autoJournalCodes: donor.autoJournalCodes as never,
            locale: donor.locale,
            brandColor: donor.brandColor,
            // Загруженный файл донора копируется ниже — своя копия и свой
            // адрес (2026-11-01): общий адрес делал логотип общим на обе
            // организации. Внешнюю ссылку берём как есть.
            logoUrl: orgLogoAssetOwner(donor.logoUrl) ? null : donor.logoUrl,
          }
        : {}),
    },
    select: { id: true },
  });

  await db.organizationMember.upsert({
    where: {
      userId_organizationId: {
        userId: input.ownerUserId,
        organizationId: organization.id,
      },
    },
    create: {
      userId: input.ownerUserId,
      organizationId: organization.id,
      role: "owner",
    },
    update: { role: "owner" },
  });

  if (donor) {
    await copyPositions(donor.id, organization.id);
    const logoOwner = orgLogoAssetOwner(donor.logoUrl);
    if (logoOwner) await copyOrgLogo(logoOwner, organization.id);
  }

  return { organizationId: organization.id };
}

/**
 * Должности с их доступом к журналам. Людей не копируем: сотрудник
 * работает в одной точке, и «клонировать» человека в другую — значит
 * завести второго с тем же именем.
 */
async function copyPositions(fromOrganizationId: string, toOrganizationId: string) {
  const positions = await db.jobPosition.findMany({
    where: { organizationId: fromOrganizationId },
    orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }],
    select: {
      id: true,
      name: true,
      categoryKey: true,
      sortOrder: true,
      journalAccess: { select: { templateId: true } },
    },
  });

  for (const position of positions) {
    const created = await db.jobPosition.create({
      data: {
        organizationId: toOrganizationId,
        name: position.name,
        categoryKey: position.categoryKey,
        sortOrder: position.sortOrder,
      },
      select: { id: true },
    });

    if (position.journalAccess.length === 0) continue;
    await db.jobPositionJournalAccess.createMany({
      data: position.journalAccess.map((access) => ({
        organizationId: toOrganizationId,
        jobPositionId: created.id,
        templateId: access.templateId,
      })),
      skipDuplicates: true,
    });
  }
}

/**
 * Аккаунт человека: свой (он владелец) либо тот, которому принадлежит его
 * домашняя организация. Нужен везде, где считается тариф и лимит мест.
 */
export async function resolveAccountId(userId: string): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      ownedAccount: { select: { id: true } },
      organization: { select: { accountId: true } },
    },
  });
  return user?.ownedAccount?.id ?? user?.organization?.accountId ?? null;
}

/**
 * Заводит аккаунт для только что зарегистрированной компании.
 *
 * Без этого организация остаётся с `accountId = null`: тариф считается
 * по одной точке, а «+ Добавить организацию» вообще не показывается —
 * человек, зарегистрировавшийся сегодня, оказался бы в худших условиях,
 * чем тот, кого перенёс миграционный скрипт.
 *
 * Идемпотентна: повторный вызов на уже связанной организации ничего не
 * меняет. Принимает `tx`, потому что вызывается внутри транзакции
 * регистрации — организация и владелец должны появиться вместе с
 * аккаунтом или не появиться вовсе.
 */
export async function attachAccountForNewOrganization(
  tx: Prisma.TransactionClient,
  input: {
    ownerUserId: string;
    organizationId: string;
    subscriptionPlan?: string;
    subscriptionEnd?: Date | null;
  },
): Promise<{ accountId: string }> {
  const account = await tx.account.upsert({
    where: { ownerUserId: input.ownerUserId },
    create: {
      ownerUserId: input.ownerUserId,
      subscriptionPlan: input.subscriptionPlan ?? "free",
      subscriptionEnd: input.subscriptionEnd ?? null,
    },
    update: {},
    select: { id: true },
  });

  await tx.organization.update({
    where: { id: input.organizationId },
    data: { accountId: account.id },
  });

  await tx.organizationMember.upsert({
    where: {
      userId_organizationId: {
        userId: input.ownerUserId,
        organizationId: input.organizationId,
      },
    },
    create: {
      userId: input.ownerUserId,
      organizationId: input.organizationId,
      role: "owner",
    },
    update: { role: "owner" },
  });

  return { accountId: account.id };
}
