/**
 * NPS: один вопрос раз в 90 дней руководителю организации старше двух недель.
 * Чистые правила здесь, база — в `nps-data.ts`. Файл client-safe: его
 * импортирует и опрос в кабинете.
 *
 * Шкалы. С сентября 2026 вопрос «Посоветуете WeSetup коллегам?» задаётся
 * по шкале 1–5: 5 — промоутер, 4 — нейтральный, 1–3 — критик. Старые ответы
 * 0–10 лежат в базе со `scale = 10` и считаются как раньше: 9–10 —
 * промоутеры, 7–8 — нейтральные, 0–6 — критики. Категория у каждого ответа
 * своя, поэтому общий NPS (доля промоутеров минус доля критиков) честно
 * считается по всем ответам сразу.
 */
export const NPS_ASK_EVERY_MS = 90 * 24 * 60 * 60 * 1000;
export const NPS_MIN_ORG_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Сколько после ответа его ещё можно поправить (сменить оценку, дописать «Что улучшить?»). */
export const NPS_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export const NPS_COMMENT_MAX_LENGTH = 1000;

/**
 * Рекомендация коллеге после оценки 4–5 — то же приглашение, что в
 * «Баланс и бонусы» (src/lib/balance/invite-colleague.ts), с лимитом
 * организации оттуда же; здесь — только добавки опроса.
 */
export const NPS_RECOMMEND_MESSAGE_MAX_LENGTH = 1000;
export const NPS_RECOMMEND_PER_USER_PER_DAY = 5;
/** Строка AuditLog на каждое письмо из опроса (кому, оценка — без текста). */
export const NPS_RECOMMEND_AUDIT_ACTION = "nps.recommend";
export const NPS_RECOMMEND_AUDIT_ENTITY = "NpsResponse";
export const NPS_RECOMMEND_DEFAULT_MESSAGE =
  "Привет! Мы ведём журналы ХАССП и СанПиН в WeSetup — заполняем с телефона по QR, проверки проходим спокойно. Посмотри, ссылка ниже.";

export type NpsScale = 5 | 10;
/** Шкала, которую спрашивает опрос сейчас. */
export const NPS_CURRENT_SCALE: NpsScale = 5;

export function shouldAskNps(input: { orgCreatedAt: Date; npsAskedAt: Date | null; now: Date }): boolean {
  if (input.now.getTime() - input.orgCreatedAt.getTime() < NPS_MIN_ORG_AGE_MS) return false;
  if (!input.npsAskedAt) return true;
  return input.now.getTime() - input.npsAskedAt.getTime() >= NPS_ASK_EVERY_MS;
}

/** Шкала ответа из базы: всё, что не 5, — старая 0–10. */
export function normalizeNpsScale(value: unknown): NpsScale {
  return value === 5 ? 5 : 10;
}

export function npsScaleRange(scale: NpsScale): { min: number; max: number } {
  return scale === 5 ? { min: 1, max: 5 } : { min: 0, max: 10 };
}

export function isNpsScoreOnScale(value: unknown, scale: NpsScale): value is number {
  const { min, max } = npsScaleRange(scale);
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** Оценка по старой шкале 0–10 (ответы без `scale`). */
export function isNpsScore(value: unknown): value is number {
  return isNpsScoreOnScale(value, 10);
}

export type NpsCategory = "promoter" | "passive" | "detractor";

export function npsCategory(score: number, scale: NpsScale = 10): NpsCategory {
  if (scale === 5) return score >= 5 ? "promoter" : score === 4 ? "passive" : "detractor";
  return score >= 9 ? "promoter" : score >= 7 ? "passive" : "detractor";
}

/** 4–5 по шкале 1–5 — предлагаем порекомендовать коллеге. */
export function npsInvitesRecommendation(score: number, scale: NpsScale): boolean {
  return scale === 5 && score >= 4 && score <= 5;
}

export type NpsSummary = { total: number; promoters: number; passives: number; detractors: number; nps: number | null; average: number | null };

type ScoredAnswer = { score: number; scale: NpsScale };

function summarize(answers: ScoredAnswer[], withAverage: boolean): NpsSummary {
  const total = answers.length;
  if (total === 0) return { total: 0, promoters: 0, passives: 0, detractors: 0, nps: null, average: null };
  let promoters = 0;
  let detractors = 0;
  for (const answer of answers) {
    const category = npsCategory(answer.score, answer.scale);
    if (category === "promoter") promoters += 1;
    else if (category === "detractor") detractors += 1;
  }
  return {
    total,
    promoters,
    passives: total - promoters - detractors,
    detractors,
    nps: Math.round(((promoters - detractors) / total) * 100),
    average: withAverage ? Math.round((answers.reduce((s, a) => s + a.score, 0) / total) * 10) / 10 : null,
  };
}

/** Старый расчёт: список оценок 0–10. */
export function computeNps(scores: number[]): NpsSummary {
  return summarize(
    scores.map((score) => ({ score, scale: 10 as const })),
    true,
  );
}

export type NpsDistributionBar = { score: number; count: number; category: NpsCategory };
export type NpsScaleReport = NpsSummary & { scale: NpsScale; distribution: NpsDistributionBar[] };
/**
 * Отчёт для /root/nps: по каждой шкале отдельно (со средней и
 * распределением) и общий NPS. Средней у общего нет — баллы разных шкал
 * не складываются.
 */
export type NpsReport = { overall: NpsSummary; scale5: NpsScaleReport; scale10: NpsScaleReport };

function scaleReport(answers: ScoredAnswer[], scale: NpsScale): NpsScaleReport {
  const own = answers.filter((a) => a.scale === scale);
  const { min, max } = npsScaleRange(scale);
  const distribution: NpsDistributionBar[] = [];
  for (let score = min; score <= max; score += 1) {
    distribution.push({ score, count: own.filter((a) => a.score === score).length, category: npsCategory(score, scale) });
  }
  return { ...summarize(own, true), scale, distribution };
}

export function computeNpsReport(rows: Array<{ score: number; scale?: number | null }>): NpsReport {
  const answers = rows.map((row) => ({ score: row.score, scale: normalizeNpsScale(row.scale) }));
  return {
    overall: summarize(answers, false),
    scale5: scaleReport(answers, 5),
    scale10: scaleReport(answers, 10),
  };
}

export function normalizeNpsComment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, NPS_COMMENT_MAX_LENGTH);
  return text || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type NpsAnswerInput =
  | { kind: "dismiss" }
  | { kind: "answer"; score: number; scale: NpsScale; comment: string | null }
  | { kind: "invalid"; error: string };

/**
 * Тело `POST /api/nps`.
 *  • `{ dismiss: true }` — «не сейчас»;
 *  • `{ score, scale: 5, comment? }` — новый опрос 1–5;
 *  • `{ score, comment? }` без `scale` — старый формат 0–10 (открытые
 *    до обновления вкладки продолжают работать).
 */
export function parseNpsAnswer(body: unknown): NpsAnswerInput {
  const input = isRecord(body) ? body : {};
  if (input.dismiss === true) return { kind: "dismiss" };
  let scale: NpsScale;
  if (input.scale === undefined || input.scale === null) scale = 10;
  else if (input.scale === 5 || input.scale === 10) scale = input.scale;
  else return { kind: "invalid", error: "Неизвестная шкала оценки" };
  if (!isNpsScoreOnScale(input.score, scale)) {
    return { kind: "invalid", error: scale === 5 ? "Оценка — от 1 до 5" : "Оценка — от 0 до 10" };
  }
  return { kind: "answer", score: input.score, scale, comment: normalizeNpsComment(input.comment) };
}

export type NpsUpdateInput =
  | { kind: "update"; id: string; score?: number; comment?: string | null }
  | { kind: "invalid"; error: string };

/**
 * Тело `PATCH /api/nps`: `{ id, score?, comment? }` — сменить оценку или
 * дописать «Что улучшить?» к только что сохранённому ответу. Диапазон
 * оценки проверяет маршрут: шкалу знает только сохранённый ответ.
 */
export function parseNpsUpdate(body: unknown): NpsUpdateInput {
  const input = isRecord(body) ? body : {};
  const id = typeof input.id === "string" ? input.id.trim() : "";
  if (!id || id.length > 64) return { kind: "invalid", error: "Ответ не найден — обновите страницу" };
  const hasScore = input.score !== undefined;
  const hasComment = input.comment !== undefined;
  if (!hasScore && !hasComment) return { kind: "invalid", error: "Нечего сохранять" };
  if (hasScore && !(typeof input.score === "number" && Number.isInteger(input.score))) {
    return { kind: "invalid", error: "Оценка — целое число" };
  }
  return {
    kind: "update",
    id,
    ...(hasScore ? { score: input.score as number } : {}),
    ...(hasComment ? { comment: normalizeNpsComment(input.comment) } : {}),
  };
}

export function canEditNpsResponse(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() <= NPS_EDIT_WINDOW_MS;
}
