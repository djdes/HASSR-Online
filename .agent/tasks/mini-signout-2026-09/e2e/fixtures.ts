// Общие константы стенда (без побочных эффектов при импорте).
export const ORG_ID = "mso-org";
export const PASSWORD = "MiniOut2026!";

/**
 * A — сотрудник с привязанным Telegram (тот, «за кого вошли»).
 * B — другой сотрудник, входит по телефону и паролю.
 * owner — руководитель с почтой: вход по почте и выход с сайта.
 */
export const USERS = {
  a: { email: "mso-a@e2e.local", name: "Анна Кузнецова", role: "cook", phone: "+79990002001", tg: "992001", position: "Повар" },
  b: { email: "mso-b@e2e.local", name: "Борис Орлов", role: "cook", phone: "+79990002002", tg: null, position: "Повар" },
  owner: { email: "mso-owner@e2e.local", name: "Ольга Власова", role: "owner", phone: "+79990002000", tg: null, position: "Управляющий" },
} as const;

export type UserKey = keyof typeof USERS;
