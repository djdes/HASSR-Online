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
] as const;

export type PpkFolderKey = (typeof PPK_FOLDERS)[number];

/** Проверка, что значение из запроса — одна из известных папок. */
export function isPpkFolder(value: unknown): value is PpkFolderKey {
  return typeof value === "string" && (PPK_FOLDERS as readonly string[]).includes(value);
}
