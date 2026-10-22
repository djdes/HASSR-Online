export const CHECKLIST_MESSAGE_KEYS = {
  nameFull: "checklist.nameFull",
  inn: "checklist.inn",
  ogrn: "checklist.ogrn",
  address: "checklist.address",
  "bank.name": "checklist.bankName",
  "bank.bik": "checklist.bik",
  "bank.account": "checklist.account",
  "bank.corrAccount": "checklist.corrAccount",
  "head.post": "checklist.headPost",
  "head.name": "checklist.headName",
  facsimileFile: "checklist.facsimile",
  stampFile: "checklist.stamp",
} as const;

export type ChecklistMessageKey = (typeof CHECKLIST_MESSAGE_KEYS)[keyof typeof CHECKLIST_MESSAGE_KEYS];

export function checklistMessageKey(key: string): ChecklistMessageKey | null {
  return Object.hasOwn(CHECKLIST_MESSAGE_KEYS, key)
    ? CHECKLIST_MESSAGE_KEYS[key as keyof typeof CHECKLIST_MESSAGE_KEYS]
    : null;
}

export const LEGACY_UPLOAD_ERROR_KEYS = {
  "Укажите, что загружаете: подпись или печать": "errors.imageKind",
  "Файл не получен": "errors.fileMissing",
  "Файл больше 1 МБ — уменьшите картинку": "errors.fileTooLarge",
  "Нужен PNG с прозрачным фоном": "errors.invalidPng",
} as const;

export type LegacyUploadErrorKey = (typeof LEGACY_UPLOAD_ERROR_KEYS)[keyof typeof LEGACY_UPLOAD_ERROR_KEYS];

export function legacyUploadErrorKey(error: string): LegacyUploadErrorKey | null {
  return Object.hasOwn(LEGACY_UPLOAD_ERROR_KEYS, error)
    ? LEGACY_UPLOAD_ERROR_KEYS[error as keyof typeof LEGACY_UPLOAD_ERROR_KEYS]
    : null;
}
