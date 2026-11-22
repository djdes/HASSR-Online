import { recordAuditLog, type AuditLogInput } from "@/lib/audit-log";
import { db } from "@/lib/db";
import { innDigits, isValidInn } from "@/lib/inn";
import { buildLegalProfile, fetchDadataParty } from "@/lib/org-legal-profile";
import { checkTrialReuse } from "@/lib/org-trial.server";

/**
 * «Счёт для юрлица» на /order у организации без ИНН (спека
 * checkout-conversion-2026-11-22): реквизиты дозаполняются прямо при
 * выставлении, без похода в настройки. ИНН — с теми же следами, что в
 * «Настройки → Организация»: запись в журнал действий и сверка пробного
 * периода по ИНН. Покупатель счёта — снимок ЕГРЮЛ; ЕГРЮЛ не ответил —
 * юридическое название, которое ввёл человек.
 *
 * Уже указанный другой ИНН здесь не меняем: это решение для настроек.
 */
export type FillInnResult = { ok: true; changed: boolean } | { ok: false; status: number; error: string; code?: string };

export async function fillOrganizationInn(args: {
  organizationId: string;
  inn: string;
  companyName?: string | null;
  session: AuditLogInput["session"] & { user?: { id?: string | null; name?: string | null } };
  request?: Request;
}): Promise<FillInnResult> {
  const inn = innDigits(args.inn);
  if (inn.length !== 10 && inn.length !== 12) return { ok: false, status: 400, error: "ИНН — 10 цифр у организации или 12 у ИП" };
  if (!isValidInn(inn)) return { ok: false, status: 400, error: "Такого ИНН не бывает — проверьте цифры" };
  const org = await db.organization.findUnique({
    where: { id: args.organizationId },
    select: { inn: true, address: true, legalFullName: true },
  });
  if (!org) return { ok: false, status: 404, error: "Организация не найдена" };
  const current = innDigits(org.inn);
  if (current === inn) return { ok: true, changed: false };
  if (current) {
    return {
      ok: false,
      status: 409,
      code: "inn-set",
      error: `У организации уже указан ИНН ${current}. Поменять его можно в настройках организации`,
    };
  }

  const party = await fetchDadataParty(inn).catch(() => null);
  const profile = party ? buildLegalProfile(party) : null;
  const companyName = args.companyName?.trim().slice(0, 300) ?? "";
  if (!profile && companyName.length < 2) {
    return { ok: false, status: 400, code: "name-required", error: "Не нашли организацию по ИНН — впишите её название, как в документах" };
  }
  const now = new Date();
  await db.organization.update({
    where: { id: args.organizationId },
    data: {
      inn,
      ...(profile
        ? {
            legalProfileJson: profile as unknown as object,
            legalProfileUpdatedAt: now,
            ...(!org.address?.trim() && profile.address ? { address: profile.address } : {}),
          }
        : { legalFullName: companyName }),
    },
  });
  await recordAuditLog({
    request: args.request,
    session: args.session,
    organizationId: args.organizationId,
    action: "organization.settings.update",
    entity: "organization",
    entityId: args.organizationId,
    details: {
      changed: {
        inn: { from: null, to: inn },
        ...(profile ? {} : { legalFullName: { from: org.legalFullName ?? null, to: companyName } }),
      },
      source: "order-invoice",
    },
  });
  // Тот же ИНН у другого аккаунта — пробный период здесь заканчивается (как в настройках).
  await checkTrialReuse({
    organizationId: args.organizationId,
    actor: args.session?.user?.id ? { userId: args.session.user.id, userName: args.session.user.name ?? null } : undefined,
  });
  return { ok: true, changed: true };
}
