import { z } from "zod";

/**
 * Состояние диалога бота MAX — пошаговое заполнение журнала. Хранится в
 * `MaxIdentity.botState` (JSON) с отметкой `botStateAt`; без отметки или
 * старше двух часов считается пустым. Значения полей — те же примитивы,
 * что принимает ядро записи (`submitJournalFill`).
 */
export const MAX_BOT_STATE_TTL_MS = 2 * 60 * 60_000;

const valueSchema = z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]);
export type MaxFillValue = z.infer<typeof valueSchema>;

const fillSchema = z.object({
  kind: z.literal("fill"),
  /** Wizard id + seq go into every button: a press from an older message is ignored. */
  id: z.string().regex(/^[a-z0-9]{1,8}$/),
  seq: z.number().int().min(0).max(1_000_000),
  orgId: z.string().min(1).max(100),
  code: z.string().min(1).max(100),
  name: z.string().max(300),
  phase: z.enum(["document", "row", "field", "correction", "confirm", "edit"]),
  documentId: z.string().max(100).nullable(),
  documentTitle: z.string().max(300).nullable(),
  rowKey: z.string().max(300).nullable(),
  rowLabel: z.string().max(300).nullable(),
  /** Документы или строки на выбор (фаза document/row). */
  choices: z.array(z.object({ id: z.string().max(300), label: z.string().max(300) })).max(60),
  step: z.number().int().min(0).max(500),
  /** Ключи полей формы на старте: форма изменилась — заполнение начинается заново. */
  keys: z.array(z.string().max(200)).max(500),
  values: z.record(z.string().max(200), valueSchema),
  /** Поля с отметкой «Выключено / нет показания». */
  off: z.array(z.string().max(200)).max(500),
  correction: z.string().max(500).nullable(),
  /** Готовые значения кнопок текущего шага (нажатие `p:<i>`). */
  picks: z.array(valueSchema).max(40),
  /** Правка одного поля с экрана проверки: после ответа — снова проверка. */
  editing: z.boolean(),
  notice: z.string().max(1000).nullable(),
});
export type MaxFillState = z.infer<typeof fillSchema>;

export function parseMaxBotState(raw: unknown, at: Date | null, now: Date = new Date()): MaxFillState | null {
  if (!raw || !at || now.getTime() - at.getTime() > MAX_BOT_STATE_TTL_MS) return null;
  const parsed = fillSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function newWizardId(random: () => number = Math.random): string {
  return Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0").slice(0, 6);
}

/** `w:<id>.<seq>:<action>[:<arg>]` — кнопка шага заполнения. */
export function wizardPayload(state: Pick<MaxFillState, "id" | "seq">, action: string, arg?: string | number): string {
  return `w:${state.id}.${state.seq}:${action}${arg === undefined ? "" : `:${arg}`}`;
}

export function parseWizardPayload(payload: string): { id: string; seq: number; action: string; arg: string | null } | null {
  const match = /^w:([a-z0-9]{1,8})\.(\d{1,7}):([a-z]{1,8})(?::([A-Za-z0-9_-]{1,40}))?$/.exec(payload);
  if (!match) return null;
  return { id: match[1], seq: Number(match[2]), action: match[3], arg: match[4] ?? null };
}
