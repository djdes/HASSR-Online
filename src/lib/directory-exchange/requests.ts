import { EXCHANGE_KINDS, normalizeExchangeKinds, type ExchangeKind } from "@/lib/directory-exchange/kinds";
import type { AccountPhase } from "@/lib/org-trial";

/**
 * Запрос на обмен справочниками с мастер-кабинетом чужого аккаунта (часть 3,
 * 2026-11-19) — чистые правила: можно ли создать запрос, можно ли принять по
 * нему решение и что владелец кабинета вправе разрешить.
 *
 * Лазейки, ради которых правила такие:
 *   • новая почта + перенос данных = бесконечный пробный период — запрос
 *     создаёт только оплаченный аккаунт (Р1);
 *   • письмами владельцу кабинета можно засыпать — один открытый запрос на
 *     пару «кабинет — организация» и не больше пяти запросов в сутки на
 *     аккаунт (Р2), считая отменённые и отклонённые; после отказа тот же
 *     аккаунт неделю не может повторить запрос в этот кабинет;
 *   • владелец кабинета не может разрешить больше, чем просили (Р3);
 *   • списки расходятся по всем участникам кабинета — поэтому чужая компания
 *     у кабинета одна: вторую связь подтвердить нельзя, пока есть первая
 *     (иначе две компании, не договаривавшиеся друг с другом, получили бы
 *     записи друг друга). Разовому переносу это не мешает;
 *   • тариф заявителя мог закончиться, пока запрос ждал, — при подтверждении
 *     он проверяется ещё раз.
 */

export const REQUEST_MODES = ["link", "transfer"] as const;
/** `link` — постоянная связь через кабинет, `transfer` — разовый перенос. */
export type RequestMode = (typeof REQUEST_MODES)[number];

export const REQUEST_STATUSES = ["pending", "approved", "declined", "cancelled", "expired"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Сколько дней ссылка из письма ждёт решения. */
export const REQUEST_TTL_DAYS = 7;
export const REQUEST_TTL_MS = REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000;
/** Сколько запросов аккаунт может создать за сутки. */
export const REQUESTS_PER_DAY = 5;
export const REQUEST_DAY_MS = 24 * 60 * 60 * 1000;
/** Сколько дней после отказа аккаунт не может повторить запрос в тот же кабинет. */
export const REQUEST_DECLINE_COOLDOWN_DAYS = 7;
export const REQUEST_DECLINE_COOLDOWN_MS = REQUEST_DECLINE_COOLDOWN_DAYS * REQUEST_DAY_MS;

export function isRequestMode(value: unknown): value is RequestMode {
  return typeof value === "string" && (REQUEST_MODES as readonly string[]).includes(value);
}

export function isRequestStatus(value: unknown): value is RequestStatus {
  return typeof value === "string" && (REQUEST_STATUSES as readonly string[]).includes(value);
}

/** До какого момента по запросу можно принять решение. */
export function requestExpiresAt(now: Date): Date {
  return new Date(now.getTime() + REQUEST_TTL_MS);
}

/** С какого момента после отказа запрос в тот же кабинет можно повторить. */
export function requestRetryAt(declinedAt: Date): Date {
  return new Date(declinedAt.getTime() + REQUEST_DECLINE_COOLDOWN_MS);
}

/** «27 ноября 2026 г.» — дата по Москве для текстов отказа. */
function refusalDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", year: "numeric" });
}

/** Открытый запрос, срок которого вышел: при чтении он становится `expired`. */
export function isRequestStale(status: string, expiresAt: Date, now: Date): boolean {
  return status === "pending" && expiresAt.getTime() <= now.getTime();
}

/* ───────────────────────── создание ───────────────────────── */

export type RequestCreationRefusal =
  /** Не выбрано ни одного списка. */
  | "no_kinds"
  /** Аккаунт не на платном тарифе (пробный, бесплатный, без тарифных правил). */
  | "not_paid"
  /** Суточный лимит запросов аккаунта исчерпан. */
  | "daily_limit"
  /** Код своего кабинета: свои организации связываются без запроса. */
  | "own_cabinet"
  /** Организация уже участвует в обмене этого кабинета. */
  | "already_member"
  /** Запрос в этот кабинет уже отправлен и ждёт решения. */
  | "open_request"
  /** Владелец этого кабинета недавно отклонил запрос аккаунта. */
  | "declined_recently";

export type RequestCreationDecision =
  | { ok: true; kinds: ExchangeKind[] }
  | { ok: false; reason: RequestCreationRefusal; status: number; message: string };

const CREATION_REFUSALS: Record<RequestCreationRefusal, { status: number; message: string }> = {
  no_kinds: { status: 400, message: "Выберите хотя бы один список" },
  not_paid: {
    status: 402,
    message:
      "Запрос в другую компанию доступен на платном тарифе. Подключите «Стандарт», «Премиум» или «ВИП» и повторите.",
  },
  daily_limit: {
    status: 429,
    message: `Не больше ${REQUESTS_PER_DAY} запросов в сутки. Попробуйте завтра.`,
  },
  own_cabinet: {
    status: 409,
    message: "Это мастер-кабинет вашего аккаунта. Свои организации связываются без запроса — выберите их в этом же окне.",
  },
  already_member: { status: 409, message: "Организация уже участвует в обмене этого мастер-кабинета" },
  open_request: { status: 409, message: "Запрос в этот мастер-кабинет уже отправлен и ждёт подтверждения" },
  // Дату в текст добавляет `decideRequestCreation`.
  declined_recently: { status: 409, message: "Владелец отклонил запрос. Повторить можно позже." },
};

/**
 * Можно ли создать запрос. Порядок отказов — не случайный: сначала то, что
 * зависит только от самого заявителя (списки, тариф, суточный лимит), и лишь
 * потом то, что говорит что-то о кабинете. Сервер проверяет первую тройку до
 * поиска кабинета по коду, поэтому тому, кому запросы недоступны, ответ не
 * сообщает даже, существует ли такой код.
 */
export function decideRequestCreation(input: {
  /** Тариф аккаунта заявителя. */
  phase: AccountPhase;
  /** Кабинет принадлежит аккаунту заявителя. */
  sameAccount: boolean;
  /** Есть открытый (ждущий, не истёкший) запрос этой организации в этот кабинет. */
  hasOpenRequest: boolean;
  /** Организация уже участник обмена этого кабинета. */
  alreadyMember: boolean;
  /** Сколько запросов аккаунт создал за последние сутки (в любом статусе). */
  requestsToday: number;
  kinds: unknown;
  /** Когда владелец этого кабинета последний раз отклонил запрос аккаунта заявителя; null — не отклонял. */
  lastDeclinedAt?: Date | null;
  /** Текущий момент — для срока после отказа. */
  now?: Date;
}): RequestCreationDecision {
  const refuse = (reason: RequestCreationRefusal, message?: string): RequestCreationDecision => ({
    ok: false,
    reason,
    ...CREATION_REFUSALS[reason],
    ...(message ? { message } : {}),
  });
  const kinds = normalizeExchangeKinds(input.kinds);
  if (kinds.length === 0) return refuse("no_kinds");
  if (input.phase !== "paid") return refuse("not_paid");
  if (Math.max(0, Math.floor(Number(input.requestsToday) || 0)) >= REQUESTS_PER_DAY) return refuse("daily_limit");
  if (input.sameAccount) return refuse("own_cabinet");
  if (input.alreadyMember) return refuse("already_member");
  if (input.hasOpenRequest) return refuse("open_request");
  if (input.lastDeclinedAt) {
    const retryAt = requestRetryAt(input.lastDeclinedAt);
    if (retryAt.getTime() > (input.now ?? new Date()).getTime()) {
      // Дата уже кончается на «г.» — точку второй раз не ставим.
      return refuse("declined_recently", `Владелец отклонил запрос. Повторить можно после ${refusalDate(retryAt)}`);
    }
  }
  return { ok: true, kinds };
}

/* ───────────────────────── решение ───────────────────────── */

export type RequestDecisionRefusal =
  /** Решает не владелец аккаунта кабинета. */
  | "not_owner"
  /** Срок запроса вышел. */
  | "expired"
  /** Заявитель отменил запрос. */
  | "cancelled"
  /** Решение уже принято (подтверждён или отклонён). */
  | "decided";

export type RequestDecisionVerdict =
  | { ok: true }
  | { ok: false; reason: RequestDecisionRefusal; status: number; message: string };

export const REQUEST_NOT_OWNER_MESSAGE =
  "Запрос может открыть только владелец аккаунта, которому он адресован. Войдите под его учётной записью.";

const DECISION_REFUSALS: Record<RequestDecisionRefusal, { status: number; message: string }> = {
  not_owner: { status: 403, message: REQUEST_NOT_OWNER_MESSAGE },
  expired: { status: 409, message: "Срок запроса истёк. Попросите отправить его заново." },
  cancelled: { status: 409, message: "Заявитель отменил этот запрос" },
  decided: { status: 409, message: "По этому запросу решение уже принято" },
};

/**
 * Можно ли подтвердить или отклонить запрос. Первым проверяется, кто решает:
 * постороннему состояние запроса не сообщается.
 */
export function decideRequestDecision(input: {
  status: string;
  expiresAt: Date;
  now: Date;
  /** Решает владелец аккаунта, которому принадлежит кабинет. */
  isCabinetOwner: boolean;
}): RequestDecisionVerdict {
  const refuse = (reason: RequestDecisionRefusal): RequestDecisionVerdict => ({ ok: false, reason, ...DECISION_REFUSALS[reason] });
  if (!input.isCabinetOwner) return refuse("not_owner");
  if (input.status === "expired" || isRequestStale(input.status, input.expiresAt, input.now)) return refuse("expired");
  if (input.status === "cancelled") return refuse("cancelled");
  if (input.status !== "pending") return refuse("decided");
  return { ok: true };
}

/* ───────────────────────── подтверждение ───────────────────────── */

export type RequestApprovalRefusal =
  /** Заявитель больше не на платном тарифе или его организация закрыта до оплаты. */
  | "requester_not_paid"
  /** Кабинет уже связан с другой компанией. */
  | "cabinet_busy";

export type RequestApprovalVerdict =
  | { ok: true }
  | { ok: false; reason: RequestApprovalRefusal; status: number; message: string };

/**
 * Можно ли подтвердить запрос прямо сейчас — сверх `decideRequestDecision`.
 * Отказ запрос не закрывает: он ждёт дальше, владелец может повторить.
 *
 * Заявитель проверяется заново: тариф мог закончиться, пока запрос ждал
 * (правило Р1 — данные получает только оплаченный аккаунт). Связь (`link`)
 * не подтверждается, пока кабинет связан с организацией ДРУГОЙ компании;
 * вторая организация той же компании и разовый перенос этим не ограничены.
 */
export function decideRequestApproval(input: {
  mode: RequestMode;
  /** Тариф аккаунта заявителя сейчас. */
  requesterPhase: AccountPhase;
  /** Организация заявителя закрыта после своих 14 дней. */
  requesterLocked: boolean;
  requesterName: string;
  /** Организация другой компании, уже связанная с кабинетом; null — такой нет. */
  linkedCompany: string | null;
}): RequestApprovalVerdict {
  if (input.requesterPhase !== "paid") {
    return {
      ok: false,
      reason: "requester_not_paid",
      status: 409,
      message: `Компания «${input.requesterName}» сейчас не на платном тарифе — подтвердить запрос нельзя. Он остаётся открытым до конца срока.`,
    };
  }
  if (input.requesterLocked) {
    return {
      ok: false,
      reason: "requester_not_paid",
      status: 409,
      message: `Организация «${input.requesterName}» сейчас закрыта до оплаты и не может принять данные. Запрос остаётся открытым до конца срока.`,
    };
  }
  if (input.mode === "link" && input.linkedCompany) {
    return {
      ok: false,
      reason: "cabinet_busy",
      status: 409,
      message: `Кабинет уже связан с компанией «${input.linkedCompany}». Отключите её или отклоните этот запрос.`,
    };
  }
  return { ok: true };
}

/**
 * Что владелец кабинета разрешает: пересечение отмеченного им с запрошенным,
 * в порядке `EXCHANGE_KINDS`. Шире запрошенного не бывает никогда. `allowed`
 * не передан (undefined или null) — разрешено всё запрошенное. null в ответе —
 * разрешать нечего: подтвердить запрос с пустым списком нельзя.
 */
export function narrowAllowedKinds(requested: unknown, allowed: unknown): ExchangeKind[] | null {
  const asked = normalizeExchangeKinds(requested);
  const given = allowed === undefined || allowed === null ? asked : normalizeExchangeKinds(allowed);
  const narrowed = EXCHANGE_KINDS.filter((kind) => asked.includes(kind) && given.includes(kind));
  return narrowed.length > 0 ? narrowed : null;
}

/** Названия списков для писем и уведомлений. */
export const EXCHANGE_KIND_LABELS: Record<ExchangeKind, string> = {
  products: "Продукция",
  staff: "Сотрудники",
  objects: "Объекты",
  equipment: "Оборудование",
};

/** «Продукция, Сотрудники» — списки через запятую, в порядке `EXCHANGE_KINDS`. */
export function exchangeKindsLabel(kinds: unknown): string {
  return normalizeExchangeKinds(kinds)
    .map((kind) => EXCHANGE_KIND_LABELS[kind])
    .join(", ");
}
