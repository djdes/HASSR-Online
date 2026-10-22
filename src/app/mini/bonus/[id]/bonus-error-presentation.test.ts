import assert from "node:assert/strict";
import test from "node:test";
import { bonusErrorKey } from "./bonus-error-presentation";

test("bonus failures adapt known API and photo-validator strings without exposing unknown diagnostics", () => {
  const cases: Array<[string, string]> = [
    ["Не авторизован", "errors.notAuthorized"],
    ["Превышен дневной лимит загрузок (60). Попробуйте завтра или обратитесь к менеджеру.", "errors.uploadLimit"],
    ["Файл не выбран", "errors.missingFile"],
    ["Подойдут JPG, PNG или WebP", "errors.invalidPhotoType"],
    ["Фото больше 5 МБ — сожмите или снимите заново", "errors.photoTooLarge"],
    ["Запись не найдена", "errors.recordNotFound"],
    ["Не удалось загрузить фото. Попробуйте ещё раз.", "errors.uploadFailed"],
    ["Некорректный JSON", "errors.invalidRequest"],
    ["photoUrl должен быть из /uploads/", "errors.invalidRequest"],
    ["Обязательство не найдено", "errors.obligationNotFound"],
    ["Это не премиальный журнал", "errors.notBonus"],
    ["Сначала возьмите эту задачу в списке «Сегодня»", "errors.claimRequired"],
    ["Премию забрал другой сотрудник", "errors.claimedByOther"],
    ["Обязательство уже выполнено", "errors.alreadyCompleted"],
    ["Не удалось прочитать загруженное фото", "errors.uploadedPhotoMissing"],
    ["В этом фото нет времени съёмки — снимите новое прямо на месте. Снимок из галереи не подойдёт", "errors.photoTimestampMissing"],
    ["Фото снято слишком давно — нужен свежий снимок, не старше 5 минут", "errors.photoTooOld"],
  ];
  for (const [message, expected] of cases) assert.equal(bonusErrorKey(message), expected, message);
  assert.equal(bonusErrorKey(new Error("socket ECONNRESET")), "errors.generic");
  assert.equal(bonusErrorKey("internal database exception"), "errors.generic");
  assert.equal(bonusErrorKey(undefined), "errors.generic");
});
