import type { InviteColleagueInput, InviteColleagueResult, InviteDelivery, InviteField } from "@/lib/balance/invite-colleague";
import { normalizeNpsScale, npsInvitesRecommendation } from "@/lib/nps";

/**
 * Рекомендация коллеге из опроса «Посоветуете WeSetup коллегам?».
 *
 * Оценка 4–5 уже сохранена (`POST /api/nps`). Здесь — только проверка,
 * что человек рекомендует от своего ответа 4–5 по шкале 1–5, дальше —
 * общее приглашение коллеги (`inviteColleague`, source = "nps"): та же
 * реферальная ссылка, письмо, лимиты и запись в «Баланс и бонусы», что и
 * у формы баланса, плюс добавки опроса (см. src/lib/balance/invite-colleague.ts).
 */

export type NpsRecommendResponseRow = {
  id: string;
  userId: string;
  organizationId: string;
  score: number;
  scale: number | null;
};

export type NpsRecommendDeps = {
  findResponse(id: string): Promise<NpsRecommendResponseRow | null>;
  inviteColleague(input: InviteColleagueInput): Promise<InviteColleagueResult>;
};

export type NpsRecommendResult =
  | { status: 200; body: { ok: true; delivery: InviteDelivery } }
  | { status: 400 | 404 | 409 | 429 | 502; body: { error: string; field?: InviteField } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Тело `POST /api/nps/recommend`: `{ responseId, email, message }`. */
export async function runNpsRecommendation(
  input: { actor: InviteColleagueInput["actor"]; body: unknown },
  deps: NpsRecommendDeps,
): Promise<NpsRecommendResult> {
  const body = isRecord(input.body) ? input.body : {};
  const responseId = typeof body.responseId === "string" ? body.responseId.trim() : "";
  if (!responseId || responseId.length > 64) return { status: 400, body: { error: "Сначала поставьте оценку" } };

  const response = await deps.findResponse(responseId);
  if (!response || response.userId !== input.actor.id) return { status: 404, body: { error: "Ответ не найден — обновите страницу" } };
  if (!npsInvitesRecommendation(response.score, normalizeNpsScale(response.scale))) {
    return { status: 400, body: { error: "Рекомендация доступна после оценки 4 или 5" } };
  }

  const result = await deps.inviteColleague({
    source: "nps",
    organizationId: response.organizationId,
    actor: input.actor,
    email: body.email,
    message: body.message,
    nps: { responseId: response.id, score: response.score },
  });
  if (!result.ok) return { status: result.status, body: result.body };
  return { status: 200, body: { ok: true, delivery: result.delivery } };
}
