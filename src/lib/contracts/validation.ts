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
