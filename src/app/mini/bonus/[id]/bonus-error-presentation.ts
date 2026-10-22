export const BONUS_ERROR_KEYS = [
  "errors.generic",
  "errors.network",
  "errors.notAuthorized",
  "errors.uploadLimit",
  "errors.missingFile",
  "errors.invalidPhotoType",
  "errors.photoTooLarge",
  "errors.recordNotFound",
  "errors.uploadFailed",
  "errors.photoRequired",
  "errors.invalidRequest",
  "errors.obligationNotFound",
  "errors.notBonus",
  "errors.claimRequired",
  "errors.claimedByOther",
  "errors.alreadyCompleted",
  "errors.uploadedPhotoMissing",
  "errors.photoTimestampMissing",
  "errors.photoTooOld",
] as const;

export type BonusErrorKey = (typeof BONUS_ERROR_KEYS)[number];

const KNOWN_ERRORS: Readonly<Record<string, BonusErrorKey>> = {
  "Не авторизован": "errors.notAuthorized",
  "Превышен дневной лимит загрузок (60). Попробуйте завтра или обратитесь к менеджеру.": "errors.uploadLimit",
  "Файл не выбран": "errors.missingFile",
  "Подойдут JPG, PNG или WebP": "errors.invalidPhotoType",
  "Фото больше 5 МБ — сожмите или снимите заново": "errors.photoTooLarge",
  "Запись не найдена": "errors.recordNotFound",
  "Не удалось загрузить фото. Попробуйте ещё раз.": "errors.uploadFailed",
  "Некорректный JSON": "errors.invalidRequest",
  "Ошибка валидации": "errors.invalidRequest",
  "photoUrl должен быть из /uploads/": "errors.invalidRequest",
  "Обязательство не найдено": "errors.obligationNotFound",
  "Это не премиальный журнал": "errors.notBonus",
  "Сначала возьмите эту задачу в списке «Сегодня»": "errors.claimRequired",
  "Премию забрал другой сотрудник": "errors.claimedByOther",
  "Обязательство уже выполнено": "errors.alreadyCompleted",
  "Не удалось прочитать загруженное фото": "errors.uploadedPhotoMissing",
  "В этом фото нет времени съёмки — снимите новое прямо на месте. Снимок из галереи не подойдёт": "errors.photoTimestampMissing",
  "Фото снято слишком давно — нужен свежий снимок, не старше 5 минут": "errors.photoTooOld",
  "Подойдут JPG, PNG или WebP.": "errors.invalidPhotoType",
  "Фото больше 5 МБ — сожмите или снимите заново.": "errors.photoTooLarge",
};

/** Exact known legacy strings are adapted; unknown server details never render. */
export function bonusErrorKey(value: unknown): BonusErrorKey {
  if (typeof value !== "string") return "errors.generic";
  return Object.hasOwn(KNOWN_ERRORS, value) ? KNOWN_ERRORS[value] : "errors.generic";
}
