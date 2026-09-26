// Общие константы стенда (без побочных эффектов при импорте).
export const PASSWORD = "LogoutAll2026!";
export const PIN = "4321";

export const ORGS = {
  cafe: { id: "lmm-cafe", name: "Кафе «Выход»" },
  master: { id: "lmm-master", name: "Мастер-кабинет Школы" },
  master2: { id: "lmm-master-2", name: "Мастер-кабинет Лицея" },
  consult: { id: "lmm-consult", name: "Консалт «Выход»" },
} as const;

/**
 * owner  — владелец аккаунта кафе, член обоих мастер-кабинетов (раздел «Кабинет»), личный QR;
 * master — сотрудник бэк-офиса: домашняя организация — мастер-кабинет, входит по приглашению;
 * cook   — повар: телефон и пароль (мини-приложение), личный QR с PIN, киоск;
 * tg     — повар с привязанным Telegram (вход next-auth `signIn("telegram")`);
 * partner — участник активного партнёра (партнёрский кабинет /partner).
 */
export const USERS = {
  owner: { email: "lmm-owner@e2e.local", name: "Ольга Власова", role: "owner", org: "cafe", phone: "+79990003000", tg: null },
  master: { email: "lmm-master@e2e.local", name: "Марина Справочная", role: "manager", org: "master", phone: null, tg: null },
  cook: { email: "lmm-cook@e2e.local", name: "Сергей Поваров", role: "cook", org: "cafe", phone: "+79990003001", tg: null },
  tg: { email: "lmm-tg@e2e.local", name: "Тимур Телеграмов", role: "cook", org: "cafe", phone: "+79990003002", tg: "993001" },
  partner: { email: "lmm-partner@e2e.local", name: "Павел Партнёров", role: "owner", org: "consult", phone: "+79990003003", tg: null },
} as const;

export type UserKey = keyof typeof USERS;

/** «Сырые» токены ссылок — в базе лежат только их хэши. */
export const INVITE_RAW = "lmm-invite-token-0123456789abcdefghijklmnopqrstu";
export const QR_RAW = { cook: "lmmCookPersonalQr0123456789", owner: "lmmOwnerPersonalQr012345678" } as const;
export const KIOSK_DEVICE_ID = "lmm-kiosk-device";
