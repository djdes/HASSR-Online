/**
 * Единственный источник ответа «кто может стоять в журнале организации».
 *
 * Раньше каждый путь создания документа выбирал людей по-своему: весь
 * ростер по алфавиту (вместе с ROOT и архивными), «владелец → технолог →
 * первый попавшийся» через `??`, id без проверки организации. В итоге в
 * журнале заказчика появлялся руководитель, которого нет среди
 * сотрудников (аккаунт мгновенной регистрации, названный почтой), а
 * выбранный в диалоге человек молча подменялся.
 *
 * Правила:
 *   • в журнал попадают только активные, не архивные, не ROOT сотрудники
 *     этой организации (`ORG_ROSTER_WHERE`);
 *   • «заглушки» (имя = почта, пустое имя, «Иванов И.И.») используются,
 *     только если больше никого нет;
 *   • заполняет — сначала подходящая должность, потом линейный персонал,
 *     потом руководство; проверяет — сначала подходящая должность, потом
 *     руководство, потом остальные;
 *   • явный выбор человека в диалоге важнее сохранённых слотов, а
 *     невалидный выбор — ошибка, а не тихая подмена.
 */

/** Категория должности сторонней бракеражной комиссии (колонка «Комиссия»). */
export const COMMISSION_CATEGORY_KEY = "commission";

/**
 * Не член сторонней бракеражной комиссии: их не ставят в гигиену, графики,
 * задачи и прочие штатные списки — они только подписывают бракераж.
 * Через `AND`, а не `NOT`: у сотрудника без должности `NOT (… IN …)` дал бы
 * NULL, и он пропал бы из всех списков.
 */
export const NOT_COMMISSION_WHERE = {
  AND: [
    {
      OR: [
        { jobPositionId: null },
        { jobPosition: { is: { categoryKey: { not: COMMISSION_CATEGORY_KEY } } } },
      ],
    },
  ],
};

export const ORG_ROSTER_WHERE = {
  isActive: true as const,
  archivedAt: null,
  isRoot: false as const,
  ...NOT_COMMISSION_WHERE,
};

/**
 * Те же живые сотрудники, но вместе со сторонней комиссией — там, где она
 * нужна: выбор себя в QR бракеража, проверка ПИН при подписи, окно комиссии,
 * сверка состава комиссии в конфиге бракеража.
 */
export const ORG_SIGNER_WHERE = {
  isActive: true as const,
  archivedAt: null,
  isRoot: false as const,
};

export type RosterUser = {
  id: string;
  name: string;
  email?: string | null;
  role?: string | null;
  isRoot?: boolean | null;
  positionTitle?: string | null;
  jobPositionName?: string | null;
  jobPositionCategory?: string | null;
};

export type RosterSlot = {
  kind: "filler" | "verifier";
  positionKeywords?: readonly string[] | null;
};

const PLACEHOLDER_NAMES = new Set(["иванов и.и.", "петров п.п.", "сидоров с.с."]);
const MANAGEMENT_ROLES = new Set(["owner", "manager", "technologist", "head_chef"]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Аккаунт-заглушка: не человек из штата, а технический или демо-вход. */
export function isPlaceholderStaffUser(user: Pick<RosterUser, "name" | "email">): boolean {
  const name = text(user.name).toLowerCase();
  if (!name) return true;
  if (PLACEHOLDER_NAMES.has(name)) return true;
  const email = text(user.email).toLowerCase();
  if (email && name === email) return true;
  // Мгновенная регистрация кладёт почту в имя; иногда её потом чуть правят.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name);
}

export function isRosterManagement(user: RosterUser): boolean {
  const category = text(user.jobPositionCategory);
  if (category === "management") return true;
  if (category === "staff") return false;
  return MANAGEMENT_ROLES.has(text(user.role));
}

function positionOf(user: RosterUser): string {
  return (text(user.jobPositionName) || text(user.positionTitle)).toLowerCase();
}

/** Убирает ROOT всегда, заглушки — только если есть кто-то ещё. */
export function filterRoster<T extends RosterUser>(users: readonly T[]): T[] {
  const withoutRoot = users.filter((user) => user.isRoot !== true);
  const real = withoutRoot.filter((user) => !isPlaceholderStaffUser(user));
  return real.length > 0 ? real : withoutRoot;
}

/**
 * Подбирает человека на слот. `used` — уже занятые в этом журнале
 * исполнители: исполнителей не дублируем, проверяющего — можно (часто это
 * одна заведующая на всё).
 */
export function rankRosterForSlot<T extends RosterUser>(
  users: readonly T[],
  slot: RosterSlot,
  used?: ReadonlySet<string>
): T | null {
  const roster = filterRoster(users);
  if (roster.length === 0) return null;

  const keywords = (slot.positionKeywords ?? [])
    .map((keyword) => keyword.toLowerCase())
    .filter(Boolean);
  const byKeyword = keywords.length
    ? roster.filter((user) => {
        const position = positionOf(user);
        return position.length > 0 && keywords.some((keyword) => position.includes(keyword));
      })
    : [];
  const management = roster.filter((user) => isRosterManagement(user));
  const staff = roster.filter((user) => !isRosterManagement(user));

  const groups = slot.kind === "verifier" ? [byKeyword, management, staff] : [byKeyword, staff, management];
  const isFree = (user: T) => !used || !used.has(user.id);

  for (const group of groups) {
    const pick = group.find(isFree);
    if (pick) return pick;
  }
  if (slot.kind === "verifier") {
    for (const group of groups) {
      if (group[0]) return group[0];
    }
  }
  return null;
}

export const RESPONSIBLE_NOT_IN_ORG_ERROR = {
  error: "Сотрудник не найден в организации",
  code: "responsible-not-in-org",
} as const;

export type ResponsibleChoice =
  | { userId: string | null; source: "body" | "slots" | "none" }
  | { error: typeof RESPONSIBLE_NOT_IN_ORG_ERROR };

/**
 * Кто станет ответственным нового документа.
 *
 *   • В теле запроса явно пришёл id → он, если это сотрудник организации;
 *     иначе ошибка (никаких подмен на владельца).
 *   • Пустая строка / null / отсутствие → слоты настроек.
 *   • Нет и слотов → null: честное «Ответственный не назначен».
 */
export function resolveResponsibleChoice(input: {
  bodyUserId: unknown;
  slotUserId?: string | null;
  orgUserIds: ReadonlySet<string>;
}): ResponsibleChoice {
  const requested = text(input.bodyUserId);
  if (requested) {
    if (!input.orgUserIds.has(requested)) return { error: RESPONSIBLE_NOT_IN_ORG_ERROR };
    return { userId: requested, source: "body" };
  }
  const slot = text(input.slotUserId);
  if (slot && input.orgUserIds.has(slot)) return { userId: slot, source: "slots" };
  return { userId: null, source: "none" };
}
