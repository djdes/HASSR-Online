import { z } from "zod";

import { db } from "@/lib/db";

import { describeDiscount } from "./rules";
import { promoPaidUses } from "./service";

/**
 * ROOT → «Промокоды»: схемы запросов, строки списка и описание изменений
 * для журнала аудита (как у акций, promotions-admin.ts). Серверный модуль.
 */

export const PROMO_CODE_AUDIT_ENTITY = "PromoCode";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Пусто → null; почта — в нижнем регистре и с проверкой формата. */
const personalEmail = z
  .string()
  .trim()
  .max(200)
  .nullable()
  .optional()
  .transform((value) => (value ? value.toLowerCase() : value === undefined ? undefined : null))
  .refine((value) => !value || EMAIL_RE.test(value), "Персональная почта: проверьте адрес");
const optionalId = z
  .string()
  .trim()
  .max(64)
  .nullable()
  .optional()
  .transform((value) => (value ? value : value === undefined ? undefined : null));
const campaignId = z
  .string()
  .trim()
  .max(100)
  .nullable()
  .optional()
  .transform((value) => (value ? value : value === undefined ? undefined : null));

export const promoCodeCreateSchema = z.object({
  code: z.string().trim().min(3).max(32),
  kind: z.enum(["percent", "fixed"]),
  value: z.number().int().min(1).max(1_000_000),
  endsAt: z.string().datetime().nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
  newClientsOnly: z.boolean().optional(),
  note: z.string().trim().max(200).optional(),
  lifetime: z.boolean().optional(),
  personalEmail,
  organizationId: optionalId,
  campaignId,
});

/** PATCH: код и размер скидки не меняются — на них уже могли сослаться. */
export const promoCodePatchSchema = z.object({
  active: z.boolean().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
  newClientsOnly: z.boolean().optional(),
  note: z.string().trim().max(200).nullable().optional(),
  lifetime: z.boolean().optional(),
  personalEmail,
  organizationId: optionalId,
  campaignId,
});

/** Организация персонального кода должна существовать. null — не указана/не найдена. */
export async function findOrganizationName(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const org = await db.organization.findUnique({ where: { id }, select: { name: true } });
  return org?.name ?? null;
}

type PromoCodeSnapshot = {
  code: string;
  kind: string;
  value: number;
  active: boolean;
  endsAt: Date | null;
  maxUses: number | null;
  newClientsOnly: boolean;
  note: string | null;
  lifetime: boolean;
  personalEmail: string | null;
  organizationId: string | null;
  campaignId: string | null;
};

/** «−10 % · навсегда · персональный: a@b.ru · рассылка oct-2026» — для аудита и логов. */
export function describePromoCode(row: PromoCodeSnapshot): string {
  const parts = [describeDiscount({ kind: row.kind === "fixed" ? "fixed" : "percent", value: row.value })];
  if (row.lifetime) parts.push("навсегда");
  const personal = [row.personalEmail, row.organizationId ? `организация ${row.organizationId}` : null]
    .filter(Boolean)
    .join(", ");
  if (personal) parts.push(`персональный: ${personal}`);
  if (row.campaignId) parts.push(`рассылка ${row.campaignId}`);
  if (!row.active) parts.push("выключен");
  return parts.join(" · ");
}

/** Кратко, что поменялось: «навсегда: да; почта — → a@b.ru; выключен». */
export function describePromoCodeChange(before: PromoCodeSnapshot, after: PromoCodeSnapshot): string {
  const parts: string[] = [];
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
  if (before.active !== after.active) parts.push(after.active ? "включён" : "выключен");
  if ((before.endsAt?.getTime() ?? null) !== (after.endsAt?.getTime() ?? null)) {
    parts.push(`срок ${iso(before.endsAt)} → ${iso(after.endsAt)}`);
  }
  if (before.maxUses !== after.maxUses) parts.push(`лимит ${before.maxUses ?? "—"} → ${after.maxUses ?? "—"}`);
  if (before.newClientsOnly !== after.newClientsOnly) {
    parts.push(after.newClientsOnly ? "только новым" : "всем");
  }
  if (before.lifetime !== after.lifetime) parts.push(`навсегда: ${after.lifetime ? "да" : "нет"}`);
  if ((before.personalEmail ?? "") !== (after.personalEmail ?? "")) {
    parts.push(`почта ${before.personalEmail ?? "—"} → ${after.personalEmail ?? "—"}`);
  }
  if ((before.organizationId ?? "") !== (after.organizationId ?? "")) {
    parts.push(`организация ${before.organizationId ?? "—"} → ${after.organizationId ?? "—"}`);
  }
  if ((before.campaignId ?? "") !== (after.campaignId ?? "")) {
    parts.push(`рассылка ${before.campaignId ?? "—"} → ${after.campaignId ?? "—"}`);
  }
  if ((before.note ?? "") !== (after.note ?? "")) parts.push("заметка изменена");
  return parts.join("; ") || "без изменений";
}

/** Строка таблицы ROOT (сериализуется в клиентский компонент). */
export type PromoCodeAdminRow = {
  id: string;
  code: string;
  kind: "percent" | "fixed";
  value: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  maxUses: number | null;
  newClientsOnly: boolean;
  note: string | null;
  lifetime: boolean;
  personalEmail: string | null;
  organizationId: string | null;
  organizationName: string | null;
  campaignId: string | null;
  paidUses: number;
};

type PromoCodeRecordRow = PromoCodeSnapshot & { id: string; startsAt: Date | null };

export function toPromoCodeAdminRow(
  row: PromoCodeRecordRow,
  extra: { paidUses: number; organizationName: string | null }
): PromoCodeAdminRow {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind === "fixed" ? "fixed" : "percent",
    value: row.value,
    active: row.active,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    maxUses: row.maxUses,
    newClientsOnly: row.newClientsOnly,
    note: row.note,
    lifetime: row.lifetime,
    personalEmail: row.personalEmail,
    organizationId: row.organizationId,
    organizationName: extra.organizationName,
    campaignId: row.campaignId,
    paidUses: extra.paidUses,
  };
}

/** Все коды, новые сверху, с оплатами и названиями организаций персональных кодов. */
export async function listPromoCodesForRoot(): Promise<PromoCodeAdminRow[]> {
  const rows = await db.promoCode.findMany({ orderBy: { createdAt: "desc" } });
  if (rows.length === 0) return [];
  const orgIds = [...new Set(rows.map((r) => r.organizationId).filter((v): v is string => Boolean(v)))];
  const [uses, orgs] = await Promise.all([
    promoPaidUses(rows.map((r) => r.code)),
    orgIds.length
      ? db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  return rows.map((row) =>
    toPromoCodeAdminRow(row, {
      paidUses: uses[row.code] ?? 0,
      organizationName: row.organizationId ? (orgName.get(row.organizationId) ?? null) : null,
    })
  );
}
