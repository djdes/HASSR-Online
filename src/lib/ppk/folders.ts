/**
 * Папки раздела «Производственный контроль» для многофайловых документов.
 * Ключ папки хранится в `KnowledgeDocument.folder`.
 */
export const PPK_FOLDERS = [
  "procedures",
  "storage",
  "guidelines",
  "team-signed",
  "lab-contract",
  "lab-protocols",
  "lab-acts",
  "pest-contract",
  "pest-acts",
  "norm-files",
  // «Пакет документов»: свои документы организации (тарифы 2026-10).
  "package",
  // Структура ППК по документу владельца (2026-11-24): файлы договоров и актов
  // (1.3), сканы своих документов вместо шаблона (2.1–2.4) и график разделения
  // потоков (приложение № 3).
  "contracts",
  "policy-scan",
  "team-regulation-scan",
  "team-leader-scan",
  "team-order-scan",
  "flow-schedule",
] as const;

export type PpkFolderKey = (typeof PPK_FOLDERS)[number];

/** Проверка, что значение из запроса — одна из известных папок. */
export function isPpkFolder(value: unknown): value is PpkFolderKey {
  return typeof value === "string" && (PPK_FOLDERS as readonly string[]).includes(value);
}
