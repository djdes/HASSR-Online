// Общие константы стенда (без побочных эффектов при импорте).
export const ORG_ID = "mqs-org";
export const PASSWORD = "MiniQr2026!";
export const USERS = {
  manager: { email: "mqs-manager@e2e.local", name: "Мария Смирнова", role: "manager", tg: "991001", position: "Управляющий" },
  cook: { email: "mqs-cook@e2e.local", name: "Иван Петров", role: "cook", tg: "991002", position: "Повар" },
} as const;
