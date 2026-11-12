# Evidence: blank-download-phone-autoreg-2026-11

Проверено 2026-11-12 на ветке `claude/pdf-download-phone-registration-asdbz8`.

| AC | Статус | Доказательство |
| --- | --- | --- |
| AC1 телефон | PASS | `blank-download-phone-autoreg.test.ts` (нормализация, `invalid_phone`, запомненный телефон); `blank-download-localization.test.ts` (поле `tel`, нет слов «необязательно», неполный номер не отправляется); `route.test.ts` (сервер отклоняет `12-34`); скриншоты `raw/form-*.png` — значки Telegram · MAX · СМС в поле. |
| AC2 уведомление | PASS | `buildBlankDownloadAdminText`: строка `Телефон: +7 985 123-45-67` сразу после почты, строка о созданном кабинете; `shouldNotifyBlankDownloadAdmin(n, true)` — всегда. Живой прогон: `AuditLog` `blank.download` содержит `phone` и `account: "created"`. |
| AC3 галка | PASS | Тест окна: `blank-download-register` отмечена по умолчанию, снятая — `register` не уходит; скриншоты. Подпись ссылается на `/oferta` и `/terms`. |
| AC4 регистрация | PASS | Живой прогон (локальный Postgres, `next dev`, iPhone 13): ответ `account: "created"`, файл скачан; в БД пользователь с телефоном `+79851234567`, организация-заглушка с источником `blank:hygiene`, журнал `hygiene` включён, `LegalConsent` `blank-download` + `blank-register`, токен входа на 7 дней. Письмо (лог dev-почты): логин, пароль, кнопка автовхода, преимущества, «14 дней». Ссылка автовхода: 307 → `/home` с сессией, повторно — `/login?magic=used`. Повторная почта: `account: "exists"`, кнопка «Войти» (`raw/done-exists-desktop.png`). |
| AC5 боты | PASS | `route.test.ts`: ловушка → 200 без токена и без обращений к DNS/БД; < 1,5 с и без замера → 400 `too_fast` без побочных эффектов. |
| AC6 письмо | PASS | `renderAccountPasswordEmail` — блок преимуществ и пробный срок (ru/en/uz), вариант для лендинга сохраняет «вы уже вошли»; `npm run i18n:types` перегенерирован. |
| AC7 телефон | PASS | Поля и кнопка 52px, текст 16px, галки 20px — `raw/form-mobile.png`. |
| AC8 проверки | PASS | `npm run typecheck` — единственная ошибка в `src/app/api/root/gogetlinks/plans/route.ts:109` есть и на `master`, к задаче не относится; `eslint` по изменённым файлам — чисто; `npm run test:changed` эскалировал до полного прогона: pass=6144, fail=0; после правки текста — 81/81 в затронутых файлах. |

Замечание: отправки по номеру (СМС-провайдера или бота, пишущего первым в Telegram/MAX) в платформе нет —
номер сохраняется и уходит продажам (см. spec.md, «Решения»).
