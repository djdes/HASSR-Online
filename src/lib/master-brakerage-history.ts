import { z } from "zod";
import { isValidIsoDate, MASTER_BRAKERAGE_ROWS_MAX, productionDateTimeFor } from "@/lib/master-brakerage-plan";
import type { MasterDelivery } from "@/lib/master-brakerage-correction";
import { brakerageCommentRequired } from "@/lib/brakerage-assessment";

export const masterBrakerageHistoryInputSchema = z.object({
  date: z.string().refine(isValidIsoDate),
  rows: z.array(z.object({ name: z.string().trim().min(1).max(500), yield: z.string().max(100), time: z.string().max(20) })).min(1).max(MASTER_BRAKERAGE_ROWS_MAX),
  common: z.object({ time: z.string().max(20), organoleptic: z.string().max(80), releaseAllowed: z.enum(["yes", "no"]), productTemp: z.string().max(20), note: z.string().max(500) }),
}).refine((input) => input.rows.every((row) => productionDateTimeFor(row, { ...input.common, date: input.date })), "Укажите время изготовления каждой позиции или общее время")
  .refine(input => !input.common.organoleptic.trim() || !brakerageCommentRequired(input.common.organoleptic) || Boolean(input.common.note.trim()), "Добавьте комментарий к оценке блюда");
export type MasterBrakerageHistoryInput = z.infer<typeof masterBrakerageHistoryInputSchema>;
export type MasterBrakerageHistoryBatch = {
  id: string;
  input: MasterBrakerageHistoryInput;
  revisions: Array<{ input: MasterBrakerageHistoryInput; changedAt: string; changedByName: string }>;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  result?: { organizations: Array<{ organizationId: string; organizationName: string; documentId: string | null; added: number; skippedNames?: string[]; delivery?: MasterDelivery }> } | null;
};
