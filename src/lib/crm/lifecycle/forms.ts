/**
 * Формы действий воронки и задач CRM (zod 4): API проверяет ими тело запроса,
 * экраны берут списки итогов и видов. Чистый модуль.
 */

import { z } from "zod";

import { DEAL_STAGES } from "./stages";

export const TASK_RESULTS = {
  reached: "Дозвонился",
  no_answer: "Не дозвонился",
  messaged: "Написал в мессенджер",
  offer_sent: "Отправил КП",
  promised: "Обещали оплатить",
  declined: "Отказ",
  done: "Сделано",
} as const;
export type TaskResult = keyof typeof TASK_RESULTS;

/** Итоги автоматики и согласования — только для показа. */
export const TASK_RESULT_LABELS: Record<string, string> = {
  ...TASK_RESULTS,
  approved: "Согласовано",
  rejected: "Отклонено",
  paid: "Оплачено",
  superseded: "Заменена новой",
  obsolete: "Неактуально",
};

export const TASK_KINDS = { call: "Позвонить", message: "Написать", offer: "Отправить КП", approval: "Согласовать скидку", invoice: "Счёт", custom: "Своя" } as const;
export type TaskKind = keyof typeof TASK_KINDS;

const resultKeys = Object.keys(TASK_RESULTS) as [TaskResult, ...TaskResult[]];

export const completeTaskSchema = z.object({
  result: z.enum(resultKeys),
  note: z.string().trim().max(2000, "Комментарий — до 2000 знаков").optional().default(""),
  /** Следующий шаг: задача «Перезвонить» на это время. */
  followUpAt: z.string().datetime({ message: "Укажите дату и время перезвона" }).nullable().optional(),
});
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;

export const taskPatchSchema = z.object({
  dueAt: z.string().datetime({ message: "Укажите дату и время" }).optional(),
  assigneeId: z.string().min(1).max(64).nullable().optional(),
});

export const manualTaskSchema = z.object({
  contactId: z.string().min(1).max(64).nullable().optional(),
  dealId: z.string().min(1).max(64).nullable().optional(),
  title: z.string().trim().min(3, "Что сделать — от 3 знаков").max(200),
  body: z.string().trim().max(4000, "Подробности — до 4000 знаков").optional().default(""),
  kind: z.enum(["call", "message", "custom"]).default("call"),
  dueAt: z.string().datetime({ message: "Укажите срок" }),
  assigneeId: z.string().min(1).max(64).nullable().optional(),
});
export type ManualTaskInput = z.infer<typeof manualTaskSchema>;

export const dealPatchSchema = z.object({
  stage: z.enum(DEAL_STAGES).optional(),
  lostReason: z.string().trim().max(500, "Причина отказа — до 500 знаков").optional(),
  ownerId: z.string().min(1).max(64).nullable().optional(),
  contractSigned: z.boolean().optional(),
});
export type DealPatch = z.infer<typeof dealPatchSchema>;

export const offerSchema = z.object({
  dealId: z.string().min(1).max(64),
  tier: z.enum(["standard", "premium", "vip"]),
  cycle: z.enum(["month", "year"]),
  points: z.number().int().min(1, "Точек — от 1").max(500, "Точек — до 500"),
  discountPercent: z.number().int().min(0, "Скидка — от 0 до 90 %").max(90, "Скидка — от 0 до 90 %"),
  /** Скидка на все продления (иначе — на первую оплату по коду). */
  lifetime: z.boolean().default(false),
  validDays: z.number().int().min(1, "Срок кода — от 1 до 60 дней").max(60, "Срок кода — от 1 до 60 дней").default(7),
  attachInvoice: z.boolean().default(true),
  toEmail: z.string().trim().email("Почта получателя").max(200),
  note: z.string().trim().max(2000, "Сопроводительный текст — до 2000 знаков").optional().default(""),
  /** Задача, из которой отправляют (закроется «Отправил КП»). */
  taskId: z.string().min(1).max(64).nullable().optional(),
});
export type OfferInput = z.infer<typeof offerSchema>;

export const approvalDecisionSchema = z.object({
  approve: z.boolean(),
  /** Согласованный процент (можно меньше запрошенного). */
  percent: z.number().int().min(1, "Скидка — от 1 до 90 %").max(90, "Скидка — от 1 до 90 %").optional(),
  comment: z.string().trim().max(1000, "Комментарий — до 1000 знаков").optional().default(""),
});
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;
