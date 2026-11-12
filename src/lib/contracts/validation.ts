import { NextResponse } from "next/server";
import { z } from "zod";

import { parseContractDate } from "./format";
import { ContractError, type ContractIssueInput } from "./service.server";

/** Тело выпуска и черновика (форма карточки ROOT). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

export const contractIssueSchema = z.object({
  date: z
    .string()
    .trim()
    .refine((value) => parseContractDate(value) !== null, "Дата договора указана с ошибкой"),
  city: z.string().trim().max(80).default(""),
  signerName: optionalText(200),
  signerPost: optionalText(200),
  signerBasis: optionalText(200),
  buyerEmail: optionalText(254).refine((value) => value === null || z.email().safeParse(value).success, "Почта для уведомлений указана с ошибкой"),
  useFacsimile: z.boolean().default(true),
  /** Реквизиты клиента из карточки — только в снимок договора. */
  buyer: z
    .object({
      nameFull: optionalText(500),
      nameShort: optionalText(300),
      inn: optionalText(20),
      kpp: optionalText(20),
      ogrn: optionalText(20),
      legalAddress: optionalText(500),
      actualAddress: optionalText(500),
      phone: optionalText(60),
      bankName: optionalText(300),
      bankBik: optionalText(20),
      bankAccount: optionalText(40),
      bankCorrAccount: optionalText(40),
    })
    .nullish()
    .transform((value) => value ?? null),
  /** Согласованный тариф: Приложение № 1. Цены берёт сервер. */
  pricing: z
    .object({
      tier: z.enum(["standard", "premium", "vip"]),
      cycle: z.enum(["month", "year"]),
      points: z.coerce.number().int("Количество точек — целое число").min(1, "Хотя бы одна точка").max(500),
      discountPercent: z.coerce.number().min(0, "Скидка не может быть отрицательной").max(100, "Скидка не больше 100 %"),
    })
    .nullish()
    .transform((value) => value ?? null),
  /** Текст договора в редакции под клиента. */
  customSections: z
    .array(
      z.object({
        title: z.string().trim().min(1, "У раздела договора нет заголовка").max(200),
        blocks: z
          .array(z.union([z.string().trim().min(1).max(4000), z.tuple([z.string().trim().min(1).max(8), z.string().trim().min(1).max(4000)])]))
          .min(1, "В разделе договора нет ни одного пункта")
          .max(80),
      }),
    )
    .max(40)
    .nullish()
    .transform((value) => (value && value.length ? value : null)),
});

export const contractSendSchema = z.object({
  to: z.array(z.string().trim().max(254)).min(1, "Укажите хотя бы один адрес почты").max(10, "Не больше 10 адресов"),
  subject: optionalText(200),
  message: optionalText(4000),
});

export function parseIssueInput(raw: unknown): { ok: true; data: ContractIssueInput } | { ok: false; response: NextResponse } {
  const parsed = contractIssueSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные" }, { status: 400 }) };
  }
  return { ok: true, data: parsed.data };
}

/** Ошибки домена → JSON-ответ; прочее пробрасывается (Next покажет 500). */
export function contractErrorResponse(error: unknown): NextResponse {
  if (error instanceof ContractError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  throw error;
}
