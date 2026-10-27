const PROFILE_ERRORS = {
  "Это действие доступно руководителю": "permissionDenied",
  "Bad request": "badRequest",
  "Название обязательно": "nameRequired",
  "Название слишком длинное": "nameTooLong",
  "ИНН должен содержать 10 или 12 цифр": "invalidInn",
  "Укажите ИНН из 10 или 12 цифр": "invalidInn",
  "Такого ИНН не бывает — проверьте цифры": "invalidInnChecksum",
  "Такой ИНН не бывает — проверьте цифры": "invalidInnChecksum",
  "Телефон в неправильном формате": "invalidPhone",
  "Email бухгалтера в неправильном формате": "invalidEmail",
  "Язык должен быть ru, en или uz": "invalidLocale",
  "Часовой пояс в формате IANA: Europe/Moscow": "invalidTimezone",
  "Брендовый цвет в формате #RRGGBB": "invalidBrandColor",
  "Цвет в формате #RRGGBB": "invalidBrandColor",
  "Укажите сайт вида dobroe-kafe.ru": "invalidWebsite",
  "URL логотипа должен начинаться с http:// или https://": "invalidLogoUrl",
  "Час окончания смены должен быть от 0 до 23": "invalidShiftEnd",
  "КПП — 9 знаков, например 770101001": "invalidKpp",
  "ОГРН — 13 цифр, ОГРНИП — 15 цифр": "invalidOgrn",
  "Нет полей для обновления": "noFields",
  "Слишком много запросов. Подождите минуту.": "rateLimited",
  "Сервис проверки по ИНН временно недоступен. Введите данные вручную.": "lookupUnavailable",
  "Сервис ЕГРЮЛ не настроен — заполните данные вручную": "registryUnconfigured",
  "Организация с таким ИНН не найдена": "notFound",
} as const;

export type OrganizationProfileApiErrorKey =
  (typeof PROFILE_ERRORS)[keyof typeof PROFILE_ERRORS];

export function mapOrganizationProfileApiError(
  error: unknown,
): OrganizationProfileApiErrorKey[] | null {
  if (typeof error !== "string") return null;
  const parts = error.split("; ");
  const keys = parts.map((part) => PROFILE_ERRORS[part as keyof typeof PROFILE_ERRORS]);
  return keys.every(Boolean) ? (keys as OrganizationProfileApiErrorKey[]) : null;
}

const DELETION_ERRORS = {
  "Доступно руководителям": "permissionDenied",
  "Организация не найдена": "organizationNotFound",
  "Демо-организацию удалить нельзя": "demoCannotDelete",
  "Введите название организации точно как в настройках": "confirmNameExactly",
  "Удаление уже запланировано": "alreadyRequested",
} as const;

export type OrganizationDeletionApiErrorKey =
  (typeof DELETION_ERRORS)[keyof typeof DELETION_ERRORS];

export function mapOrganizationDeletionApiError(
  error: unknown,
): OrganizationDeletionApiErrorKey | null {
  if (typeof error !== "string") return null;
  return DELETION_ERRORS[error as keyof typeof DELETION_ERRORS] ?? null;
}
