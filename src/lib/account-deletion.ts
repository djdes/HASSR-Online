import crypto from "node:crypto";

/**
 * Удаление аккаунта самим человеком — требование App Store и Google Play:
 * удалить аккаунт должно быть можно из приложения и со страницы сайта
 * (`/delete-account`).
 *
 * Здесь только чистая логика (решение и данные обезличивания), чтобы её
 * можно было проверить тестом без базы. Выполнение — в
 * `src/app/api/account/delete/route.ts`.
 *
 * Правила:
 *   • ROOT платформы свой аккаунт так не удаляет — только вручную;
 *   • владелец компании (или последний руководитель, если владельца нет)
 *     идёт в удаление компании с отсрочкой 30 дней — иначе компания
 *     молча осталась бы без руководителя;
 *   • остальные — как архивирование сотрудника + обезличивание: имя,
 *     почта, телефон, Telegram, PIN, ключи входа стираются, а записи
 *     журналов остаются у компании (это данные компании, СанПиН/ХАССП).
 */

/** Слово, которое человек вводит для подтверждения. */
export const ACCOUNT_DELETE_CONFIRM_WORD = "УДАЛИТЬ";

/** Куда вести владельца: карточка «Удалить организацию» в настройках. */
export const ORGANIZATION_DELETION_HREF = "/settings/organization#delete";

export type AccountDeletionSubject = {
  isRoot: boolean;
  /** Владелец аккаунта-подписки (`Account.ownerUserId`) или участник с ролью owner. */
  isOwnerOfOrganization: boolean;
  /** Роль руководителя (manager / head_chef и legacy-синонимы). */
  isManagement: boolean;
  /** Сколько ещё активных руководителей в его компании, кроме него. */
  otherManagersCount: number;
  /** Демо-кабинет: его удаление через настройки запрещено, он удаляется сам. */
  isDemoOrganization: boolean;
};

export type AccountDeletionPlan =
  | { kind: "anonymize" }
  | { kind: "organization"; href: string }
  | { kind: "forbidden"; reason: string };

export function planAccountDeletion(user: AccountDeletionSubject): AccountDeletionPlan {
  if (user.isRoot) {
    return {
      kind: "forbidden",
      reason: "Аккаунт администратора платформы удаляется только вручную.",
    };
  }
  const leavesCompanyWithoutHead =
    user.isOwnerOfOrganization || (user.isManagement && user.otherManagersCount <= 0);
  if (leavesCompanyWithoutHead) {
    if (user.isDemoOrganization) {
      return {
        kind: "forbidden",
        reason: "Это демо-кабинет: он удалится сам вместе со всеми данными, удалять ничего не нужно.",
      };
    }
    return { kind: "organization", href: ORGANIZATION_DELETION_HREF };
  }
  return { kind: "anonymize" };
}

/**
 * Владелец компании. Три признака, потому что владение описывалось
 * по-разному в разные годы:
 *   • `Account.ownerUserId` — аккаунт-подписка (регистрации последних версий);
 *   • `OrganizationMember.role = "owner"` — владелец сети организаций;
 *   • `User.role = "owner"` — legacy-роль старых компаний без Account.
 * Пропустить любой — значит обезличить владельца и оставить компанию
 * без хозяина (так и случилось на стенде с legacy-ролью).
 */
export function isOrganizationOwner(user: {
  role: string | null | undefined;
  ownsAccount: boolean;
  hasOwnerMembership: boolean;
}): boolean {
  return user.ownsAccount || user.hasOwnerMembership || user.role === "owner";
}

/** Тело запроса `{ confirm: "УДАЛИТЬ" }` — регистр и пробелы как в ConfirmDialog. */
export function isAccountDeleteConfirmed(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const confirm = (body as { confirm?: unknown }).confirm;
  return (
    typeof confirm === "string" &&
    confirm.trim().toUpperCase() === ACCOUNT_DELETE_CONFIRM_WORD
  );
}

/**
 * Поля `User`, которые перезаписываются при удалении аккаунта.
 *
 * Личное — стираем: почта для входа и контактная, телефон,
 * Telegram, PIN для QR, лента календаря, IP, согласие на фото,
 * подтверждение почты. Имя НЕ трогаем: журналы СанПиН и ХАССП хранят
 * автора записи (компания обязана показать его проверяющему), а имя
 * в них берётся из карточки — «Удалённый сотрудник» вместо фамилии
 * сделал бы старые записи ничьими. Так же ведёт себя архивирование. Флаги «ответственный»/«может править» снимаем,
 * чтобы удалённый не всплывал в выборе людей. Должность и права не
 * личные — остаются, по ним журналы продолжают читаться.
 *
 * `email` уникален на платформе — ставим синтетический адрес на id.
 * `passwordHash` — случайная строка, не bcrypt: ни один пароль к ней не
 * подойдёт. Сессии отзываются отдельно (`sessionVersion`).
 */
export function anonymizedUserData(userId: string, now: Date = new Date()) {
  return {
    email: `deleted-${userId}@deleted.wesetup.local`,
    contactEmail: null,
    phone: null,
    telegramChatId: null,
    passwordHash: crypto.randomBytes(32).toString("hex"),
    qrPinHash: null,
    qrPinEncrypted: null,
    qrPinFailedCount: 0,
    qrPinLockedUntil: null,
    calendarToken: null,
    registrationIp: null,
    lastLoginIp: null,
    kioskPhotoConsentAt: null,
    emailVerifiedAt: null,
    twoFactorTelegram: false,
    canEditBrakerageDishes: false,
    keepsCoreJournals: false,
    canManageSettings: false,
    lastActiveOrganizationId: null,
    lastActiveBuildingId: null,
    isActive: false as const,
    archivedAt: now,
  };
}
